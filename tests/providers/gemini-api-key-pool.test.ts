import { describe, expect, test } from "bun:test";
import { getProviderRegistryEntry } from "../../src/providers/registry";
import { FREE_PROVIDER_DIRECTORY } from "../../src/providers/free-directory";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearKeyCooldowns,
  getKeyCooldownUntil,
  getKeyMinuteUsage,
  isGoogleNonRetryablePool429,
  parseQuotaResetAt,
  recordKeyMinuteUsage,
  rotateProviderTransportOn429,
  rotateProviderTransportOn5xx,
  isAiStudioModelCongested,
  markAiStudioModelCongested,
  selectProactiveApiKeyTransport,
  shouldProactivelyFallbackGoogleToAntigravity,
} from "../../src/providers/key-failover";
import { createGoogleAdapter } from "../../src/adapters/google";
import { parseRequest } from "../../src/responses/parser";
import { withTestTranslatorBudget } from "../helpers/translator-budget";
import { removeTreeWithRetry } from "../helpers/remove-tree";
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
      antigravityAccounts: [{ id: "ag1", email: "user@example.com", aiStudioApiKey: "AIzaSyAntigravityKey111111" }],
      standaloneUpdate: { email: "sync@example.com", apiKey: "AIzaSyStandaloneKey222222" },
    });
    expect(cfg.providers.google?.apiKeyPool?.map(e => e.label)).toEqual([
      "user@example.com",
      "sync@example.com",
    ]);
    expect(cfg.providers.google?.cacheAffinity).toBe("off");
    expect(cfg.providers.google?.showThinkingSummary).toBe(true);
    expect(cfg.providers.google?.retryOnReset).toEqual({ enabled: true, replacements: 2 });

    // Subsequent Antigravity update must not wipe standalone email key
    syncGoogleApiKeyPool({
      config: cfg,
      antigravityAccounts: [{ id: "ag1", email: "user@example.com", aiStudioApiKey: "AIzaSyAntigravityKey111111" }],
    });
    expect(cfg.providers.google?.apiKeyPool?.map(e => e.label)).toEqual([
      "user@example.com",
      "sync@example.com",
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
          email: "Alpha@example.com",
          aiStudioApiKey: "AIzaSyAlpha1234567890123456",
          active: true,
          plan: "g1-pro-tier",
        },
        {
          id: "__main__",
          provider: "openai",
          providerLabel: "OpenAI / Codex",
          email: "alpha@example.com",
          active: false,
          plan: "plus",
        },
        {
          id: "xai-1",
          provider: "xai",
          providerLabel: "xAI Grok",
          email: "alpha@example.com",
          active: false,
          plan: "GROK",
        },
        {
          id: "cg-2",
          provider: "openai",
          providerLabel: "OpenAI / Codex",
          email: "only-cg@example.com",
          active: false,
          plan: "plus",
        },
      ],
      [
        {
          entryId: "e2",
          email: "only-cg@example.com",
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
    const alpha = groups.find(g => g.emailKey === "alpha@example.com")!;
    expect(alpha.antigravity?.id).toBe("ag-1");
    expect(alpha.aiStudio?.apiKey).toBe("AIzaSyAlpha1234567890123456");
    expect(alpha.chatgpt?.id).toBe("__main__");
    expect(alpha.grok?.id).toBe("xai-1");

    const icloud = groups.find(g => g.emailKey === "only-cg@example.com")!;
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

describe("AI Studio key pool optimization & Antigravity fallback", () => {
  const now = 1_700_500_000_000;

  function makeOptConfig(): { config: OcxConfig; provider: OcxProviderConfig } {
    const provider: OcxProviderConfig = {
      adapter: "google",
      baseUrl: "https://generativelanguage.googleapis.com",
      authMode: "key",
      apiKey: "AIza-opt-1",
      apiKeyPool: [
        { id: "opt-1", key: "AIza-opt-1", addedAt: 1 },
        { id: "opt-2", key: "AIza-opt-2", addedAt: 2 },
        { id: "opt-3", key: "AIza-opt-3", addedAt: 3 },
      ],
      requestPacing: { enabled: true, keySelection: "round-robin" },
      cacheAffinity: "off",
      showThinkingSummary: true,
    };
    const config = {
      port: 0,
      hostname: "127.0.0.1",
      defaultProvider: "google",
      providers: { google: provider },
    } as unknown as OcxConfig;
    return { config, provider };
  }

  test("limit: 0 429 does not poison cooldowns and marks non-retryable pool 429", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for metric: generate_content_free_tier_input_token_count, limit: 0, model: gemini-4-argon.",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "75041s" }],
      },
    });
    expect(parseQuotaResetAt(body, now)).toBeUndefined();
    expect(isGoogleNonRetryablePool429(body, 5_000)).toBe(true);
  });

  test("per-minute 250k token limit triggers non-retryable pool 429 on oversized >230k request", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for metric: generate_content_free_tier_input_token_count, limit: 250000, model: gemini-4-hydrogen, description: Generate content input tokens per minute limit exceeded.",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              { quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier", quotaValue: "250000" },
            ],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "36s" },
        ],
      },
    });
    expect(isGoogleNonRetryablePool429(body, 250_000)).toBe(true);
    expect(isGoogleNonRetryablePool429(body, 120_000)).toBe(false);
  });

  test("60s sliding-window minute usage prefers keys with lower recent token load", () => {
    const { config, provider } = makeOptConfig();
    clearKeyCooldowns("google");
    const routed = routedProviderConfig("google", provider);

    recordKeyMinuteUsage("google", "opt-1", 190_000, now);
    recordKeyMinuteUsage("google", "opt-2", 185_000, now);
    expect(getKeyMinuteUsage("google", "opt-1", now)).toEqual({ requests: 1, tokens: 190_000 });

    const picked = selectProactiveApiKeyTransport(config, "google", routed, undefined, now);
    expect(picked?.apiKey).toBe("AIza-opt-3");
    expect(getKeyMinuteUsage("google", "opt-1", now + 61_000)).toEqual({ requests: 0, tokens: 0 });
  });

  test("rotateProviderTransportOn5xx cools failed key for 15s and rotates to next healthy key", () => {
    const { config, provider } = makeOptConfig();
    clearKeyCooldowns("google");
    const routed = routedProviderConfig("google", provider);

    const first = selectProactiveApiKeyTransport(config, "google", routed, undefined, now)!;
    const second = rotateProviderTransportOn5xx(config, "google", first, {
      status: 503,
      now,
      attemptedKey: first.apiKey,
    });
    expect(second).not.toBeNull();
    expect(second?.apiKey).not.toBe(first.apiKey);

    const failedId = first._apiKeyAttempt!.entryId;
    expect(getKeyCooldownUntil("google", failedId, now)).toBe(now + 15_000);
  });

  test("cross-key AI Studio thoughtSignature replay preserves signatures across key rotations", async () => {
    const home = mkdtempSync(join(tmpdir(), "ocx-aistudio-replay-"));
    const prevHome = process.env.OPENCODEX_HOME;
    process.env.OPENCODEX_HOME = home;
    try {
      const sig = "CiQAx-aistudio-cross-key-thought-signature-0123456789";
      const providerKey1: OcxProviderConfig = {
        adapter: "google",
        baseUrl: "https://generativelanguage.googleapis.com",
        authMode: "key",
        apiKey: "AIza-replay-key-1",
      };
      const adapter1 = withTestTranslatorBudget(createGoogleAdapter(providerKey1));
      const req1 = parseRequest({
        model: "gemini-4-hydrogen",
        stream: true,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "check weather" }] }],
      });
      await adapter1.buildRequest(req1);

      const ssePayload = `data: ${JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { thought: true, text: "thinking...", thoughtSignature: sig },
              { functionCall: { name: "get_weather", args: { city: "NYC" } } },
            ],
          },
          finishReason: "STOP",
        }],
      })}\n\n`;
      const events: unknown[] = [];
      for await (const ev of adapter1.parseStream(new Response(ssePayload, {
        headers: { "content-type": "text/event-stream" },
      }))) {
        events.push(ev);
      }
      expect(events.length).toBeGreaterThan(0);

      // Next turn arrives via a DIFFERENT AI Studio API key in the pool without client extra_content
      const providerKey2: OcxProviderConfig = {
        ...providerKey1,
        apiKey: "AIza-replay-key-2",
      };
      const adapter2 = withTestTranslatorBudget(createGoogleAdapter(providerKey2));
      const req2 = parseRequest({
        model: "gemini-4-hydrogen",
        tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "check weather" }] },
          { type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{\"city\":\"NYC\"}" },
          { type: "function_call_output", call_id: "call_1", output: "sunny" },
        ],
      });
      const built2 = await adapter2.buildRequest(req2);
      const wireBody = JSON.parse(String(built2.body)) as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> };
      const modelTurn = wireBody.contents.find(c => c.role === "model");
      expect(modelTurn?.parts[0]?.thoughtSignature).toBe(sig);
    } finally {
      if (prevHome === undefined) delete process.env.OPENCODEX_HOME;
      else process.env.OPENCODEX_HOME = prevHome;
      removeTreeWithRetry(home);
    }
  });

  test("shouldProactivelyFallbackGoogleToAntigravity detects unentitled models and >235k tokens", () => {
    const home = mkdtempSync(join(tmpdir(), "ocx-fallback-test-"));
    const prevHome = process.env.OPENCODEX_HOME;
    process.env.OPENCODEX_HOME = home;
    try {
      writeFileSync(join(home, "auth.json"), JSON.stringify({
        "google-antigravity": {
          activeAccountId: "ag-pro-1",
          accounts: [{
            id: "ag-pro-1",
            credential: {
              access: "ya29.test-access",
              refresh: "1//test-refresh",
              expires: Date.now() + 3_600_000,
              projectId: "proj-1",
              plan: "g1-pro-tier",
            },
          }],
        },
      }));

      const { config } = makeOptConfig();
      config.providers["google-antigravity"] = {
        adapter: "google",
        googleMode: "cloud-code-assist",
        authMode: "oauth",
        baseUrl: "https://daily-cloudcode-pa.googleapis.com",
      } as unknown as OcxProviderConfig;
      clearKeyCooldowns("google");

      expect(shouldProactivelyFallbackGoogleToAntigravity(config, "gemini-4-argon", 1_000, now)).toBe(true);
      expect(shouldProactivelyFallbackGoogleToAntigravity(config, "gemini-4-hydrogen", 250_000, now)).toBe(true);
      expect(shouldProactivelyFallbackGoogleToAntigravity(config, "gemini-4-hydrogen", 120_000, now)).toBe(false);

      // Marking the model as congested triggers proactive circuit-breaking to Antigravity for 3m.
      markAiStudioModelCongested("gemini-4-hydrogen", now);
      expect(isAiStudioModelCongested("gemini-4-hydrogen", now)).toBe(true);
      expect(shouldProactivelyFallbackGoogleToAntigravity(config, "gemini-4-hydrogen", 120_000, now)).toBe(true);
      expect(shouldProactivelyFallbackGoogleToAntigravity(config, "gemini-4-hydrogen", 120_000, now + 3 * 60_000 + 1)).toBe(false);

      markAiStudioModelCongested("gemini-4-hydrogen", now);
      clearKeyCooldowns("google");
      expect(isAiStudioModelCongested("gemini-4-hydrogen", now)).toBe(false);
    } finally {
      if (prevHome === undefined) delete process.env.OPENCODEX_HOME;
      else process.env.OPENCODEX_HOME = prevHome;
      removeTreeWithRetry(home);
    }
  });
});
