import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAccountQuotaExhausted, rankAccountsByHeadroom } from "../../src/oauth/account-quota-rank";
import {
  clearGenericFailoverHealth, preferredInitialAccount, rotateGenericOAuthAccountOn429,
  rotateAntigravityAccountOnAuthRefusal,
} from "../../src/oauth/generic-account-failover";
import { credentialGeneration, getAccountSet, saveCredential, setActiveAccount,
  setAccountPaused, markAccountNeedsReauth } from "../../src/oauth/store";
import {
  clearAccountQuotaCache, getCachedProviderAccountQuota, setCachedProviderAccountQuotaForTests,
  sweepExpiredProviderAccountQuotaRows,
  fetchProviderAccountQuotas, setAntigravityAccountQuotaTransportForTests,
} from "../../src/providers/quota";
import { commitProbedAccountQuota, persistAccountQuotaCache } from "../../src/providers/quota/account-cache";
import { readPersistedAccountQuotas } from "../../src/providers/account-quota-disk";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import type { OcxConfig } from "../../src/types";

const PROVIDER = "google-antigravity";
const MODEL = "gemini-3.8-flash";
const HOUR = 3600_000;
const originalHome = process.env.OPENCODEX_HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ocx-antigravity-reset-"));
  process.env.OPENCODEX_HOME = home;
  clearAccountQuotaCache();
  clearGenericFailoverHealth();
});

afterEach(() => {
  clearAccountQuotaCache();
  clearGenericFailoverHealth();
  setAntigravityAccountQuotaTransportForTests(null);
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  removeTreeWithRetry(home);
});

function config(enabled = true): OcxConfig {
  return { providers: { [PROVIDER]: {
    adapter: "google", authMode: "oauth", oauthAccountFailover: { enabled },
  } } } as unknown as OcxConfig;
}

function seed(id: string, fiveHour: number, weekly: number, resetAt?: number,
  family = "Gem", fiveHourResetAt?: number, updatedAt = Date.now()): void {
  setCachedProviderAccountQuotaForTests(PROVIDER, id, { updatedAt, customWindows: [
    { label: family, percent: fiveHour, ...(fiveHourResetAt === undefined ? {} : { resetAt: fiveHourResetAt }) },
    { label: `${family} (Weekly)`, percent: weekly, ...(resetAt === undefined ? {} : { resetAt }) },
  ] });
}

async function accounts(): Promise<string[]> {
  for (let i = 0; i < 3; i++) await saveCredential(PROVIDER, {
    access: `test-access-${i}`, refresh: `test-refresh-${i}`,
    accountId: `test-account-${i}`, expires: Date.now() + HOUR,
  });
  return getAccountSet(PROVIDER)!.accounts.map(row => row.id);
}

describe("Antigravity staggered weekly activation", () => {
  test("a started week outranks an untouched account with more allowance", () => {
    seed("started", 85, 70, Date.now() + HOUR);
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "started"], MODEL)).toEqual(["started", "untouched"]);
  });

  test("the earliest weekly reset wins before remaining headroom or roster order", () => {
    seed("later", 5, 5, Date.now() + 48 * HOUR);
    seed("earlier", 90, 90, Date.now() + HOUR);
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "later", "earlier"], MODEL))
      .toEqual(["earlier", "later", "untouched"]);
  });

  test("a full five-hour window skips to another started week, not an untouched account", () => {
    seed("earlier", 100, 80, Date.now() + HOUR);
    seed("later", 80, 80, Date.now() + 48 * HOUR);
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "earlier", "later"], MODEL)[0]).toBe("later");
  });

  test("an untouched account is used only after all started accounts are exhausted", () => {
    seed("five-hour-spent", 100, 20, Date.now() + HOUR);
    seed("week-spent", 20, 100, Date.now() + 48 * HOUR);
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["five-hour-spent", "week-spent", "untouched"], MODEL)[0])
      .toBe("untouched");
  });

  test("unknown five-hour allowance does not prematurely activate a new account", () => {
    setCachedProviderAccountQuotaForTests(PROVIDER, "started", { updatedAt: Date.now(),
      customWindows: [{ label: "Gem (Weekly)", percent: 10, resetAt: Date.now() + HOUR }] });
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "started"], MODEL)[0]).toBe("started");
  });

  test("five-hour exhaustion expires without erasing the still-running week", () => {
    const now = Date.now();
    seed("started", 100, 80, now + HOUR, "Gem", now - 1);
    seed("untouched", 0, 0);
    expect(isAccountQuotaExhausted(PROVIDER, "started", MODEL)).toBe(false);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "started"], MODEL)[0]).toBe("started");
  });

  test("an ended week no longer outranks a still-running week", () => {
    const now = Date.now();
    seed("ended", 0, 100, now - 1);
    seed("started", 80, 80, now + HOUR);
    expect(isAccountQuotaExhausted(PROVIDER, "ended", MODEL)).toBe(false);
    expect(rankAccountsByHeadroom(PROVIDER, ["ended", "started"], MODEL)[0]).toBe("started");
  });

  test("Gemini priority does not use the Claude weekly timer", () => {
    seed("claude-started", 0, 10, Date.now() + HOUR, "Cla");
    seed("gemini-started", 80, 80, Date.now() + 48 * HOUR);
    expect(rankAccountsByHeadroom(PROVIDER, ["claude-started", "gemini-started"], MODEL)[0])
      .toBe("gemini-started");
    expect(rankAccountsByHeadroom(PROVIDER, ["gemini-started", "claude-started"], "gpt-oss-120b")[0])
      .toBe("claude-started");
  });

  test("legacy models quota reset does not pretend to be a weekly timer", () => {
    setCachedProviderAccountQuotaForTests(PROVIDER, "legacy", { updatedAt: Date.now(),
      customWindows: [{ label: "Gem", percent: 0, resetAt: Date.now() + HOUR }] });
    seed("started", 80, 80, Date.now() + 48 * HOUR);
    expect(rankAccountsByHeadroom(PROVIDER, ["legacy", "started"], MODEL)[0]).toBe("started");
  });

  for (const resetAt of [NaN, Infinity, 0, Date.now() + 8 * 24 * HOUR]) {
    test(`invalid or out-of-window weekly reset ${resetAt} does not establish priority`, () => {
      seed("invalid", 0, 0, resetAt);
      seed("started", 80, 80, Date.now() + HOUR);
      expect(rankAccountsByHeadroom(PROVIDER, ["invalid", "started"], MODEL)[0]).toBe("started");
    });
  }

  test("without weekly activation evidence the existing headroom rank is preserved", () => {
    seed("a", 80, 80);
    seed("b", 20, 20);
    expect(rankAccountsByHeadroom(PROVIDER, ["a", "b"], MODEL)).toEqual(["b", "a"]);
    expect(rankAccountsByHeadroom("xai", ["a", "b"], MODEL)).toEqual(["a", "b"]);
  });

  test("equal weekly deadlines retain headroom and caller-order tie breakers", () => {
    const resetAt = Date.now() + HOUR;
    seed("a", 80, 80, resetAt);
    seed("b", 20, 20, resetAt);
    seed("c", 20, 20, resetAt);
    expect(rankAccountsByHeadroom(PROVIDER, ["a", "c", "b"], MODEL)).toEqual(["c", "b", "a"]);
  });

  test("initial dispatch prefers the earliest started week over a healthy active account", async () => {
    const [untouched, later, earlier] = await accounts();
    seed(untouched, 0, 0);
    seed(later, 20, 20, Date.now() + 48 * HOUR);
    seed(earlier, 90, 90, Date.now() + HOUR);
    await setActiveAccount(PROVIDER, untouched);
    expect(preferredInitialAccount(config(), PROVIDER, Date.now(), MODEL)).toBe(earlier);
    await setActiveAccount(PROVIDER, earlier);
    expect(preferredInitialAccount(config(), PROVIDER, Date.now(), MODEL)).toBeNull();
    expect(preferredInitialAccount(config(false), PROVIDER, Date.now(), MODEL)).toBeNull();
  });

  test("429 recovery keeps using started accounts and then releases an untouched one", async () => {
    const [failed, untouched, started] = await accounts();
    const now = Date.now();
    seed(failed, 100, 20, now + HOUR);
    seed(untouched, 0, 0);
    seed(started, 80, 80, now + 48 * HOUR);
    expect(rotateGenericOAuthAccountOn429(config(), PROVIDER, failed, null, now, MODEL)).toBe(started);
    expect(rotateGenericOAuthAccountOn429(config(), PROVIDER, started, null, now, MODEL)).toBe(untouched);
  });

  test("authentication recovery also prefers a started week without bypassing activation consent", async () => {
    const [failed, untouched, started] = await accounts();
    seed(untouched, 0, 0);
    seed(started, 80, 80, Date.now() + HOUR);
    const generation = credentialGeneration(getAccountSet(PROVIDER)!.accounts.find(row => row.id === failed)!.credential);
    expect(rotateAntigravityAccountOnAuthRefusal(false, failed, generation, MODEL)).toBeNull();
    expect(rotateAntigravityAccountOnAuthRefusal(true, failed, generation, MODEL)).toBe(started);
  });

  test("paused and reauthentication-required accounts never win on their weekly deadline", async () => {
    const [untouched, paused, reauth] = await accounts();
    seed(untouched, 0, 0);
    seed(paused, 10, 10, Date.now() + HOUR);
    seed(reauth, 10, 10, Date.now() + 2 * HOUR);
    await setAccountPaused(PROVIDER, paused, true);
    await markAccountNeedsReauth(PROVIDER, reauth, true);
    await setActiveAccount(PROVIDER, untouched);
    expect(preferredInitialAccount(config(), PROVIDER, Date.now(), MODEL)).toBeNull();
  });

  test("explicit kernel fill-first retains its configured strategy", async () => {
    const [selected, started] = await accounts();
    seed(selected, 0, 0);
    seed(started, 80, 80, Date.now() + HOUR);
    await setActiveAccount(PROVIDER, selected);
    const cfg = config();
    cfg.pool = { kernel: true };
    cfg.providers[PROVIDER]!.oauthAccountFailover!.strategy = "fill-first";
    expect(preferredInitialAccount(cfg, PROVIDER, Date.now(), MODEL)).toBeNull();
  });

  test("a live week survives the ordinary cache sweep, but expires after its reset", () => {
    const now = Date.now();
    seed("started", 80, 80, now + 24 * HOUR);
    expect(sweepExpiredProviderAccountQuotaRows(now + HOUR)).toBe(0);
    expect(getCachedProviderAccountQuota(PROVIDER, "started")).not.toBeNull();
    expect(sweepExpiredProviderAccountQuotaRows(now + 25 * HOUR)).toBe(1);
  });

  test("a models-only fallback cannot forget a previously observed running week", () => {
    const now = Date.now();
    seed("started", 80, 80, now + HOUR);
    const entry = { ts: now, quota: {
      updatedAt: now, customWindows: [{ label: "Gem", percent: 90 }],
    } };
    commitProbedAccountQuota(`${PROVIDER}\u0000started`, entry);
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "started"], MODEL)[0]).toBe("started");
    expect(entry.quota.customWindows)
      .toContainEqual({ label: "Gem (Weekly)", percent: 80, resetAt: now + HOUR });
  });

  test("a new weekly snapshot or an ended week is not overwritten by old activation evidence", () => {
    const now = Date.now();
    for (const resetAt of [now - 1, now + HOUR]) {
      seed("started", 80, 80, resetAt);
      const windows = resetAt > now ? [{ label: "Gem (Weekly)", percent: 0 }] : [{ label: "Gem", percent: 0 }];
      commitProbedAccountQuota(`${PROVIDER}\u0000started`, { ts: now, quota: { updatedAt: now, customWindows: windows } });
      expect(getCachedProviderAccountQuota(PROVIDER, "started")?.customWindows).toEqual(windows);
    }
  });

  test("a live week survives disk age and is available to the first request after restart", async () => {
    const now = Date.now();
    seed("started", 100, 80, now + 24 * HOUR, "Gem", now - HOUR, now - 7 * HOUR);
    persistAccountQuotaCache();
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(readPersistedAccountQuotas().has(`${PROVIDER}\u0000started`)).toBe(true);
    clearAccountQuotaCache();
    seed("untouched", 0, 0);
    expect(rankAccountsByHeadroom(PROVIDER, ["untouched", "started"], MODEL)[0]).toBe("started");
  });

  test("a successful accounting probe automatically persists the weekly timer without inference", async () => {
    await saveCredential(PROVIDER, { access: "test-access", refresh: "test-refresh", projectId: "test-project",
      accountId: "test-account", expires: Date.now() + HOUR });
    const resetAt = Date.now() + 24 * HOUR;
    let calls = 0;
    setAntigravityAccountQuotaTransportForTests({
      resolveAddresses: async () => ({ hostname: "daily-cloudcode-pa.googleapis.com",
        addresses: [{ address: "142.250.0.1", family: 4 }], privateNetwork: false }),
      pinnedPost: async url => {
        expect(url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
        calls++;
        return Response.json({ groups: [{ displayName: "Gemini", buckets: [
          { window: "5h", remainingFraction: 0.8 },
          { window: "weekly", remainingFraction: 0.8, resetTime: new Date(resetAt).toISOString() },
        ] }] });
      },
    });
    const rows = await fetchProviderAccountQuotas(PROVIDER);
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(calls).toBe(1);
    expect(readPersistedAccountQuotas().get(`${PROVIDER}\u0000${rows[0]!.accountId}`)?.customWindows)
      .toContainEqual({ label: "Gem (Weekly)", percent: 20, resetAt });
  });
});
