import type { OcxConfig } from "../types";
import { acquireAccountLease, type AccountLease } from "./kiro-account-load";
import { eligibleFailoverAccounts, preferKiroModelSupport } from "./generic-account-failover";
import { classifyModelFamilyForQuota, isAccountQuotaExhausted, rankAccountsByHeadroom } from "./account-quota-rank";
import { captureOAuthAccountSelection, credentialGeneration, getAccountSet, setActiveAccount } from "./store";
import type { OAuthAccountSelection } from "./types";
import type { OAuthAccessSnapshot } from "./index";

const PROVIDER = "google-antigravity";

/** Explicit opt-in; never changes another provider's or a disabled pool's behavior. */
export function antigravityAccountCap(config: OcxConfig, provider: string): number | undefined {
  const row = config.providers[provider];
  const cap = row?.oauthAccountFailover?.maxConcurrentPerAccount;
  return provider === PROVIDER && row?.authMode === "oauth"
    && (row.oauthAccountFailover?.enabled ?? config.oauthAccountFailover?.enabled) === true
    && typeof cap === "number" && Number.isInteger(cap) && cap >= 1 && cap <= 100 ? cap : undefined;
}

/** Reserve before credential awaits so simultaneous conversations cannot all pick one idle slot. */
export async function reserveAntigravityAccount(
  config: OcxConfig, preferred: string | null, model: string, signal?: AbortSignal,
): Promise<AccountLease | null> {
  const cap = antigravityAccountCap(config, PROVIDER);
  if (cap === undefined || signal?.aborted) return null;
  const set = getAccountSet(PROVIDER);
  const rows = new Map(set?.accounts.map(row => [row.id, row]));
  let eligible = preferKiroModelSupport(PROVIDER,
    eligibleFailoverAccounts(PROVIDER, Date.now(), classifyModelFamilyForQuota(PROVIDER, model)), model, config)
    .filter(id => !isAccountQuotaExhausted(PROVIDER, id, model, rows.get(id)));

  // Multi-account deadlock breakout: if all unexhausted accounts are temporarily cooled by a retry storm,
  // break out using unexhausted candidates so a pool of healthy accounts never collapses to 503 capacity full.
  if (eligible.length === 0 && set) {
    const unexhausted = set.accounts
      .filter(a => a.paused !== true && a.needsReauth !== true && !isAccountQuotaExhausted(PROVIDER, a.id, model, a))
      .map(a => a.id);
    if (unexhausted.length >= 2) {
      eligible = preferKiroModelSupport(PROVIDER, unexhausted, model, config);
    }
  }

  const preferredId = preferred ?? set?.activeAccountId;
  const ring = preferredId && eligible.includes(preferredId)
    ? [preferredId, ...eligible.filter(id => id !== preferredId)] : eligible;
  const candidates = rankAccountsByHeadroom(PROVIDER, ring, model, rows);

  // Auto-promotion: if current active account's weekly quota is 100% exhausted, automatically promote the healthiest candidate to active
  if (set?.activeAccountId && isAccountQuotaExhausted(PROVIDER, set.activeAccountId, model, rows.get(set.activeAccountId))) {
    const healthyCandidate = candidates.find(id => id !== set.activeAccountId && !isAccountQuotaExhausted(PROVIDER, id, model, rows.get(id)));
    if (healthyCandidate) {
      void setActiveAccount(PROVIDER, healthyCandidate).catch(() => {});
    }
  }

  for (const id of candidates) {
    const lease = await acquireAccountLease(PROVIDER, id, { maxConcurrentPerAccount: cap, signal });
    if (signal?.aborted) { lease?.release(); return null; }
    if (lease) return lease;
  }
  return null;
}

/** Request-local admission: parallel selections never rewrite the operator's active account. */
export function antigravitySnapshotIsCurrent(
  snapshot: OAuthAccessSnapshot, expected: OAuthAccountSelection | null, model: string,
): boolean {
  if (snapshot.provider !== PROVIDER || !snapshot.projectId || !expected) return false;
  const selection = captureOAuthAccountSelection(PROVIDER);
  if (selection?.accountId !== expected.accountId || selection?.revision !== expected.revision) return false;
  const row = getAccountSet(PROVIDER)?.accounts.find(account => account.id === snapshot.accountId);
  return !!row && !row.paused && !row.needsReauth && row.credential.expires > Date.now()
    && credentialGeneration(row.credential) === snapshot.generation
    && eligibleFailoverAccounts(PROVIDER, Date.now(), classifyModelFamilyForQuota(PROVIDER, model)).includes(row.id)
    && !isAccountQuotaExhausted(PROVIDER, row.id, model, row);
}
