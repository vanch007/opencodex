import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityAccountCap, reserveAntigravityAccount, antigravitySnapshotIsCurrent } from "../../src/oauth/antigravity-capacity";
import { accountInFlight, type AccountLease } from "../../src/oauth/kiro-account-load";
import { captureOAuthAccountSelection, getAccountSet, saveCredential, setActiveAccount, setAccountPaused } from "../../src/oauth/store";
import { getValidAccessSnapshotForAccount } from "../../src/oauth";
import { clearGenericFailoverHealth, rotateGenericOAuthAccountOn429 } from "../../src/oauth/generic-account-failover";
import { clearAccountQuotaCache, setCachedProviderAccountQuotaForTests } from "../../src/providers/quota";
import { unifiedPoolSettingsDto } from "../../src/oauth/pool-settings-capability";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import type { OcxConfig } from "../../src/types";

const provider = "google-antigravity", model = "gemini-3.8-flash";
const originalHome = process.env.OPENCODEX_HOME;
let home: string;
const leases: AccountLease[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ocx-antigravity-capacity-"));
  process.env.OPENCODEX_HOME = home;
  clearGenericFailoverHealth(); clearAccountQuotaCache();
});
afterEach(() => {
  leases.splice(0).forEach(lease => lease.release());
  clearGenericFailoverHealth(); clearAccountQuotaCache();
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  removeTreeWithRetry(home);
});
function config(cap = 1): OcxConfig {
  return { providers: { [provider]: { adapter: "google", authMode: "oauth",
    oauthAccountFailover: { enabled: true, strategy: "fill-first", maxConcurrentPerAccount: cap } } } } as OcxConfig;
}
async function seed() {
  for (let i = 0; i < 3; i++) await saveCredential(provider, { access: `fixture-access-${i}`,
    refresh: `fixture-refresh-${i}`, expires: Date.now() + 3600_000, accountId: `fixture-${i}`,
    projectId: `fixture-project-${i}` }, { addAccount: true });
  const ids = getAccountSet(provider)!.accounts.map(row => row.id);
  await setActiveAccount(provider, ids[0]!);
  return ids;
}
async function reserve(cfg = config(), preferred: string | null = null, signal?: AbortSignal) {
  const lease = await reserveAntigravityAccount(cfg, preferred, model, signal);
  if (lease) leases.push(lease);
  return lease;
}
test("parallel admission grows only to demand and reuses released capacity without global selection writes", async () => {
  const ids = await seed();
  const selection = captureOAuthAccountSelection(provider);
  const batch = await Promise.all([reserve(), reserve(), reserve()]);
  expect(new Set(batch.map(lease => lease?.accountId)).size).toBe(3);
  expect(ids.map(id => accountInFlight(provider, id))).toEqual([1, 1, 1]);
  expect(await reserve()).toBeNull();
  batch[0]!.release();
  expect((await reserve(config(), batch[0]!.accountId))?.accountId).toBe(batch[0]!.accountId);
  expect(captureOAuthAccountSelection(provider)).toEqual(selection);
});
test("cap two fills one account before opening another", async () => {
  const [a, b] = await seed();
  expect((await reserve(config(2)))?.accountId).toBe(a);
  expect((await reserve(config(2)))?.accountId).toBe(a);
  expect((await reserve(config(2)))?.accountId).toBe(b);
});
test("started weekly windows precede untouched reserve accounts", async () => {
  const [a, b, c] = await seed();
  setCachedProviderAccountQuotaForTests(provider, b!, { updatedAt: Date.now(), customWindows: [
    { label: "Gem weekly", percent: 20, resetAt: Date.now() + 3600_000 },
  ] });
  expect((await reserve(config(), a!))?.accountId).toBe(b);
  expect((await reserve(config(), a!))?.accountId).toBe(a);
  expect((await reserve(config(), a!))?.accountId).toBe(c);
});
test("paused, cooled and exhausted accounts cannot receive overflow", async () => {
  const [a, b, c] = await seed();
  await setAccountPaused(provider, a!, true);
  rotateGenericOAuthAccountOn429(config(), provider, b!, "60", Date.now(), model);
  setCachedProviderAccountQuotaForTests(provider, c!, { updatedAt: Date.now(), customWindows: [{ label: "Gem", percent: 100 }] });
  expect(await reserve()).toBeNull();
});
test("429 recovery skips a sibling whose serving slot is occupied", async () => {
  const [a, b, c] = await seed();
  expect((await reserve(config(), b!))?.accountId).toBe(b);
  expect(rotateGenericOAuthAccountOn429(config(), provider, a!, "60", Date.now(), model)).toBe(c);
});
test("request-local snapshot admits a sibling but rejects operator selection changes and pauses", async () => {
  const [a, b] = await seed();
  const selection = captureOAuthAccountSelection(provider);
  const snapshot = await getValidAccessSnapshotForAccount(provider, b!, { requireUsableAccount: true });
  expect(antigravitySnapshotIsCurrent(snapshot, selection, model)).toBe(true);
  expect(captureOAuthAccountSelection(provider)?.accountId).toBe(a);
  await setActiveAccount(provider, a!);
  expect(antigravitySnapshotIsCurrent(snapshot, selection, model)).toBe(false);
  const current = captureOAuthAccountSelection(provider);
  await setAccountPaused(provider, b!, true);
  expect(antigravitySnapshotIsCurrent(snapshot, current, model)).toBe(false);
});
test("disabled pools, other providers and aborted callers cannot reserve", async () => {
  const ids = await seed();
  const cfg = config(); cfg.providers[provider]!.oauthAccountFailover!.enabled = false;
  expect(antigravityAccountCap(cfg, provider)).toBeUndefined();
  expect(antigravityAccountCap(config(), "xai")).toBeUndefined();
  expect(await reserve(cfg)).toBeNull();
  expect(await reserve(config(), null, AbortSignal.abort())).toBeNull();
  expect(ids.map(id => accountInFlight(provider, id))).toEqual([0, 0, 0]);
  const dto = unifiedPoolSettingsDto(config(), provider, "generic");
  expect(dto.supported).toContain("maxConcurrentPerAccount");
  expect(dto.maxConcurrentPerAccount).toBe(1);
});
