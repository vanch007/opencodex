import { describe, expect, test } from "bun:test";
import { getProviderRegistryEntry } from "../../src/providers/registry";
import { FREE_PROVIDER_DIRECTORY } from "../../src/providers/free-directory";
import {
  clearKeyCooldowns,
  getKeyCooldownUntil,
  parseQuotaResetAt,
  rotateProviderTransportOn429,
  selectProactiveApiKeyTransport,
} from "../../src/providers/key-failover";
import { routedProviderConfig } from "../../src/providers/routed-config";
import type { OcxConfig, OcxProviderConfig } from "../../src/types";

describe("Gemini 4 Hydrogen catalog presence", () => {
  test("gemini-4-hydrogen is present in google provider registry", () => {
    const entry = getProviderRegistryEntry("google");
    expect(entry).toBeDefined();
    expect(entry?.models).toContain("gemini-4-hydrogen");
    expect(entry?.modelContextWindows?.["gemini-4-hydrogen"]).toBe(1_048_576);
    expect(entry?.modelInputModalities?.["gemini-4-hydrogen"]).toEqual(["text", "image"]);
    expect(entry?.modelReasoningEfforts?.["gemini-4-hydrogen"]).toEqual(["low", "medium", "high", "xhigh"]);
    expect(entry?.modelDefaultReasoningEfforts?.["gemini-4-hydrogen"]).toBe("high");
  });

  test("gemini-4-hydrogen is present in free-directory gemini preset", () => {
    const gemini = FREE_PROVIDER_DIRECTORY.find(p => p.id === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini?.models).toContain("gemini-4-hydrogen");
  });
});

describe("Google AI Studio 429 quota reset & daily limit parsing", () => {
  const now = 1_700_000_000_000;

  test("parses explicit retryDelay in RetryInfo detail", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Resource has been exhausted (e.g. check quota).",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "3600s",
          },
        ],
      },
    });
    const resetAt = parseQuotaResetAt(body, now);
    expect(resetAt).toBe(now + 3_600_000);
  });

  test("parses fractional retryDelay in RetryInfo detail", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "45.5s",
          },
        ],
      },
    });
    const resetAt = parseQuotaResetAt(body, now);
    expect(resetAt).toBe(now + 45_500);
  });

  test("detects daily quota exhaustion (Queries per day) and sets reset to Pacific midnight", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'generativelanguage.googleapis.com' for consumer 'project_number:12345'.",
      },
    });
    const resetAt = parseQuotaResetAt(body, now);
    expect(resetAt).toBeDefined();
    expect(resetAt!).toBeGreaterThan(now);
    expect(resetAt! - now).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  test("detects daily quota exhaustion from ErrorInfo / QuotaFailure details", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Resource has been exhausted (e.g. check quota).",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
            metadata: {
              quota_limit: "Queries per day",
              quota_metric: "Queries",
            },
          },
        ],
      },
    });
    const resetAt = parseQuotaResetAt(body, now);
    expect(resetAt).toBeDefined();
    expect(resetAt!).toBeGreaterThan(now);
  });

  test("leaves transient per-minute rate limits undefined so standard retry applies", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'GenerateContent requests per minute' of service 'generativelanguage.googleapis.com'",
      },
    });
    const resetAt = parseQuotaResetAt(body, now);
    expect(resetAt).toBeUndefined();
  });
});

describe("Gemini multi-key automatic balancing & failover", () => {
  const now = 1_700_000_000_000;

  function makeGoogleConfig(): { config: OcxConfig; provider: OcxProviderConfig } {
    const provider: OcxProviderConfig = {
      adapter: "google",
      baseUrl: "https://generativelanguage.googleapis.com",
      authMode: "key",
      apiKey: "AIza-key-1",
      apiKeyPool: [
        { id: "key-1", key: "AIza-key-1", addedAt: 1 },
        { id: "key-2", key: "AIza-key-2", addedAt: 2 },
        { id: "key-3", key: "AIza-key-3", addedAt: 3 },
      ],
      requestPacing: {
        enabled: true,
        keySelection: "round-robin",
      },
    };
    const config = {
      port: 0,
      hostname: "127.0.0.1",
      defaultProvider: "google",
      providers: { google: provider },
    } as unknown as OcxConfig;
    return { config, provider };
  }

  test("automatically balances requests round-robin across multiple Gemini API keys", () => {
    const { config, provider } = makeGoogleConfig();
    clearKeyCooldowns("google");
    const routed = routedProviderConfig("google", provider);

    const selections = Array.from({ length: 6 }, () =>
      selectProactiveApiKeyTransport(config, "google", routed, undefined, now),
    );

    expect(selections.map(s => s?.apiKey)).toEqual([
      "AIza-key-1",
      "AIza-key-2",
      "AIza-key-3",
      "AIza-key-1",
      "AIza-key-2",
      "AIza-key-3",
    ]);
  });

  test("rotates to next key and cools down exhausted key on Google 429 daily limit", () => {
    const { config, provider } = makeGoogleConfig();
    clearKeyCooldowns("google");
    const routed = routedProviderConfig("google", provider);

    // Pick first key (key-1)
    const firstTransport = selectProactiveApiKeyTransport(config, "google", routed, undefined, now)!;
    expect(firstTransport.apiKey).toBe("AIza-key-1");

    // key-1 hits Google AI Studio daily limit
    const errorBody = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'",
      },
    });
    const quotaResetAt = parseQuotaResetAt(errorBody, now);
    expect(quotaResetAt).toBeDefined();

    // 429 failover occurs
    const secondTransport = rotateProviderTransportOn429(config, "google", firstTransport, {
      now,
      attemptedKey: firstTransport.apiKey,
      quotaResetAt,
    });

    // Successfully failed over to key-2
    expect(secondTransport).not.toBeNull();
    expect(secondTransport?.apiKey).toBe("AIza-key-2");

    // key-1 is placed into cooldown until Pacific midnight
    const key1Cooldown = getKeyCooldownUntil("google", "key-1", now);
    expect(key1Cooldown).toBe(quotaResetAt);

    // Subsequent requests now automatically balance between key-2 and key-3 (bypassing key-1)
    const nextSelections = Array.from({ length: 4 }, () =>
      selectProactiveApiKeyTransport(config, "google", routed, undefined, now),
    );
    expect(nextSelections.map(s => s?.apiKey)).toEqual([
      "AIza-key-3",
      "AIza-key-2",
      "AIza-key-3",
      "AIza-key-2",
    ]);
    expect(nextSelections.some(s => s?.apiKey === "AIza-key-1")).toBe(false);
  });

  test("associating AI Studio API key with Antigravity account persists and exposes aiStudioApiKey", async () => {
    const { setAccountAiStudioApiKey, getAccountSet } = await import("../../src/oauth/store");
    const set = getAccountSet("google-antigravity");
    if (!set || set.accounts.length === 0) return;
    const testAccount = set.accounts[0];
    expect(testAccount).toBeDefined();
    const prevKey = testAccount.aiStudioApiKey;

    const testKey = "AIzaSyTestKey1234567890abcdef";
    const ok = await setAccountAiStudioApiKey("google-antigravity", testAccount.id, testKey);
    expect(ok).toBe(true);

    const freshSet = getAccountSet("google-antigravity");
    const freshAccount = freshSet?.accounts.find(a => a.id === testAccount.id);
    expect(freshAccount?.aiStudioApiKey).toBe(testKey);

    // Restore original value
    await setAccountAiStudioApiKey("google-antigravity", testAccount.id, prevKey);
    const cleanedSet = getAccountSet("google-antigravity");
    expect(cleanedSet?.accounts.find(a => a.id === testAccount.id)?.aiStudioApiKey).toBe(prevKey);
  });
});

describe("AI Studio local quota & email-merged account grouping", () => {
  test("computes Pacific midnight boundaries cleanly and daily limits by plan tier", async () => {
    const {
      startOfPacificDayMs,
      nextPacificMidnightMs,
      buildAiStudioLocalQuotaForKey,
    } = await import("../../src/server/management/ai-studio-local-quota");

    const now = Date.UTC(2026, 10, 16, 10, 0, 0);
    const start = startOfPacificDayMs(now);
    const next = nextPacificMidnightMs(now);
    expect(start).toBeLessThanOrEqual(now);
    expect(next).toBeGreaterThan(now);
    expect(next - start).toBe(24 * 3600_000);

    const proQuota = buildAiStudioLocalQuotaForKey({
      apiKey: "AIzaSyTestProKey1234567890",
      plan: "g1-pro-tier",
      now,
      usage: { requestsToday: 25, hydrogenUsedToday: 20, flashUsedToday: 5, argonUsedToday: 0, tokensToday: 2_500_000 },
    });
    expect(proQuota.planTier).toBe("pro");
    expect(proQuota.dailyRequestLimit).toBe(100);
    expect(proQuota.dailyTokenLimit).toBe(25_000_000);
    expect(proQuota.remainingPercent).toBe(75);

    const freeQuota = buildAiStudioLocalQuotaForKey({
      apiKey: "AIzaSyTestFreeKey1234567890",
      plan: "free-tier",
      now,
      usage: { requestsToday: 50, hydrogenUsedToday: 50, flashUsedToday: 0, argonUsedToday: 0, tokensToday: 500_000 },
    });
    expect(freeQuota.planTier).toBe("free");
    expect(freeQuota.dailyRequestLimit).toBe(50);
    expect(freeQuota.dailyExhausted).toBe(true);
    expect(freeQuota.remainingPercent).toBe(0);
  });

  test("syncGoogleApiKeyPool preserves standalone email keys alongside Antigravity keys", async () => {
    const { syncGoogleApiKeyPool } = await import("../../src/server/management/ai-studio-local-quota");
    const cfg = { providers: {} } as unknown as OcxConfig;

    syncGoogleApiKeyPool({
      config: cfg,
      antigravityAccounts: [{ id: "ag1", email: "user@gmail.com", aiStudioApiKey: "AIzaSyAntigravityKey111111" }],
      standaloneUpdate: { email: "icloud@icloud.com", apiKey: "AIzaSyStandaloneKey222222" },
    });
    expect(cfg.providers.google?.apiKeyPool?.map(e => e.label)).toEqual([
      "user@gmail.com",
      "icloud@icloud.com",
    ]);

    // Subsequent Antigravity update must not wipe standalone email key
    syncGoogleApiKeyPool({
      config: cfg,
      antigravityAccounts: [{ id: "ag1", email: "user@gmail.com", aiStudioApiKey: "AIzaSyAntigravityKey111111" }],
    });
    expect(cfg.providers.google?.apiKeyPool?.map(e => e.label)).toEqual([
      "user@gmail.com",
      "icloud@icloud.com",
    ]);
  });

  test("buildEmailAccountGroups merges Antigravity, AI Studio, ChatGPT, and Grok by email", async () => {
    const { buildEmailAccountGroups } = await import("../../gui/src/components/accounts/email-account-groups");
    const groups = buildEmailAccountGroups(
      [
        {
          id: "ag-1",
          provider: "google-antigravity",
          providerLabel: "Google Antigravity",
          email: "Alpha@gmail.com",
          aiStudioApiKey: "AIzaSyAlpha1234567890123456",
          active: true,
          plan: "g1-pro-tier",
        },
        {
          id: "__main__",
          provider: "openai",
          providerLabel: "OpenAI / Codex",
          email: "alpha@gmail.com",
          active: false,
          plan: "plus",
        },
        {
          id: "xai-1",
          provider: "xai",
          providerLabel: "xAI Grok",
          email: "alpha@gmail.com",
          active: false,
          plan: "GROK",
        },
        {
          id: "cg-2",
          provider: "openai",
          providerLabel: "OpenAI / Codex",
          email: "only-cg@icloud.com",
          active: false,
          plan: "plus",
        },
      ],
      [
        {
          entryId: "e2",
          email: "only-cg@icloud.com",
          aiStudioApiKey: "AIzaSyIcloud123456789012345",
          aiStudioQuota: {
            entryId: "e2",
            maskedKey: "AIza****2345",
            planTier: "free",
            requestsToday: 2,
            dailyRequestLimit: 50,
            hydrogenUsedToday: 2,
            hydrogenLimit: 50,
            flashUsedToday: 0,
            flashLimit: 50,
            argonUsedToday: 0,
            argonLimit: 0,
            tokensToday: 1000,
            dailyTokenLimit: 10_000_000,
            remainingPercent: 96,
            inCooldown: false,
            dailyExhausted: false,
            resetAt: Date.now() + 3600_000,
          },
        },
      ],
    );

    expect(groups).toHaveLength(2);
    const alpha = groups.find(g => g.emailKey === "alpha@gmail.com")!;
    expect(alpha.antigravity?.id).toBe("ag-1");
    expect(alpha.aiStudio?.apiKey).toBe("AIzaSyAlpha1234567890123456");
    expect(alpha.chatgpt?.id).toBe("__main__");
    expect(alpha.grok?.id).toBe("xai-1");

    const icloud = groups.find(g => g.emailKey === "only-cg@icloud.com")!;
    expect(icloud.antigravity).toBeUndefined();
    expect(icloud.grok).toBeUndefined();
    expect(icloud.chatgpt?.id).toBe("cg-2");
    expect(icloud.aiStudio?.quota?.remainingPercent).toBe(96);
  });

  test("inferXaiPlanFromAccessToken extracts account tier from xAI JWT claims", async () => {
    const { inferXaiPlanFromAccessToken } = await import("../../src/oauth/xai");
    const makeJwt = (payload: Record<string, unknown>) =>
      `hdr.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
    expect(inferXaiPlanFromAccessToken(makeJwt({ sub: "u1", tier: 2 }))).toBe("pro");
    expect(inferXaiPlanFromAccessToken(makeJwt({ sub: "u2", tier: 3 }))).toBe("ultra");
    expect(inferXaiPlanFromAccessToken(makeJwt({ sub: "u3", tier: 1 }))).toBe("plus");
    expect(inferXaiPlanFromAccessToken(makeJwt({ sub: "u4" }))).toBeUndefined();
  });
});
