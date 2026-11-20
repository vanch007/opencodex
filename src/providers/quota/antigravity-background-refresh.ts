import { antigravityCliUserAgent } from "../../adapters/client-fingerprint";
import { getConfigDir } from "../../config/paths";
import { providerOutboundPost, providerRedirectError } from "../../lib/provider-outbound";
import { registerStateSweepAfterTick } from "../../lib/state-store-sweeper";
import { getValidAccessSnapshotForAccount } from "../../oauth";
import { getAccountSet } from "../../oauth/store";
import type { OcxConfig, OcxProviderConfig } from "../../types";
import {
  antigravityAccountRosterObservedAt,
  captureAntigravityModelObservation,
  recordAntigravityAccountRoster,
} from "../antigravity-account-roster";
import { parseAntigravityAvailableModels } from "../antigravity-models";
import { isRegistryModelDiscoveryUrl, readBoundedDiscoveryJson } from "../model-discovery";
import { MODEL_DISCOVERY_MAX_MODELS, MODEL_DISCOVERY_MAX_RESPONSE_BYTES } from "../model-discovery-limits";
import { fetchProviderAccountQuotas, getCachedProviderAccountQuota } from "../quota";

const PROVIDER = "google-antigravity";
const DEFAULT_ANTIGRAVITY_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
const DISCOVERY_TIMEOUT_MS = 8_000;

/** Periodically refresh Antigravity account quota windows every 10 minutes. */
export const ANTIGRAVITY_BACKGROUND_QUOTA_REFRESH_MS = 10 * 60_000;
/** Refresh per-account model rosters at half the 6-hour roster TTL so entitlements never lapse to unknown. */
export const ANTIGRAVITY_BACKGROUND_ROSTER_REFRESH_MS = 3 * 60 * 60_000;
/** Cooldown between failed per-account background roster probes. */
export const ANTIGRAVITY_BACKGROUND_FAILURE_BACKOFF_MS = 10 * 60_000;

export interface AntigravityBackgroundRosterRefreshTarget {
  provider: OcxProviderConfig;
  accountId: string;
  root: string;
}

export interface AntigravityBackgroundRefreshDeps {
  now?: () => number;
  fetchQuotas?: (
    provider: string,
    forceRefresh: boolean,
    providerConfig?: OcxProviderConfig,
    liveConfig?: OcxConfig,
  ) => Promise<unknown>;
  refreshAccountRoster?: (target: AntigravityBackgroundRosterRefreshTarget) => Promise<void>;
}

let inFlight: Promise<void> | null = null;
const lastQuotaAttemptByRoot = new Map<string, number>();
const lastRosterAttemptByAccount = new Map<string, number>();

async function refreshAntigravityAccountRosterOnce(
  { provider, accountId, root }: AntigravityBackgroundRosterRefreshTarget,
): Promise<void> {
  if (getConfigDir() !== root) return;
  const snapshot = await getValidAccessSnapshotForAccount(PROVIDER, accountId, {
    requireUsableAccount: true,
    authorityCurrent: () => getConfigDir() === root,
  });
  const project = provider.project ?? snapshot.projectId;
  if (!project || getConfigDir() !== root) return;

  const base = (provider.baseUrl?.trim() || DEFAULT_ANTIGRAVITY_BASE_URL).replace(/\/+$/, "");
  const url = `${base}/v1internal:fetchAvailableModels`;
  const observation = captureAntigravityModelObservation();
  // Model discovery must use the CLI UA so Gemini 4 codename ids (Argon, Hydrogen, Neon) are returned.
  const response = await providerOutboundPost(
    PROVIDER,
    provider,
    url,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": antigravityCliUserAgent(),
        Authorization: `Bearer ${snapshot.accessToken}`,
      },
      body: JSON.stringify({ project }),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    },
    {
      isCanonicalUrl: isRegistryModelDiscoveryUrl,
      beforeSend: () => getConfigDir() === root,
    },
  );
  if (!response.ok || await providerRedirectError(response, url)) return;
  const bounded = await readBoundedDiscoveryJson(response, MODEL_DISCOVERY_MAX_RESPONSE_BYTES);
  if (!bounded.ok || getConfigDir() !== root) return;
  const models = parseAntigravityAvailableModels(bounded.value, MODEL_DISCOVERY_MAX_MODELS);
  if (!models || getConfigDir() !== root) return;
  recordAntigravityAccountRoster(PROVIDER, accountId, models, Date.now(), observation);
}

/**
 * Single-flight background pass keeping Antigravity account quotas and `:fetchAvailableModels`
 * rosters fresh so high-tier models (e.g. `gemini-4-hydrogen`) are never misrouted after TTL lapse.
 */
export async function runAntigravityBackgroundRefresh(
  config: OcxConfig,
  deps?: AntigravityBackgroundRefreshDeps,
): Promise<void> {
  if (inFlight) return inFlight;
  const pass = (async () => {
    const prov = config.providers[PROVIDER];
    if (!prov || prov.disabled === true || prov.authMode !== "oauth") return;

    const accounts = getAccountSet(PROVIDER)?.accounts.filter(
      account => account.paused !== true && account.needsReauth !== true,
    ) ?? [];
    if (accounts.length === 0) return;

    const root = getConfigDir();
    const currentNow = () => deps?.now?.() ?? Date.now();

    const nowForQuota = currentNow();
    const quotaDue = accounts.some(account => {
      const cached = getCachedProviderAccountQuota(PROVIDER, account.id);
      return !cached || nowForQuota - cached.updatedAt >= ANTIGRAVITY_BACKGROUND_QUOTA_REFRESH_MS;
    });
    const lastQuotaAttempt = lastQuotaAttemptByRoot.get(root);
    if (
      quotaDue
      && (lastQuotaAttempt === undefined || nowForQuota - lastQuotaAttempt >= ANTIGRAVITY_BACKGROUND_QUOTA_REFRESH_MS)
    ) {
      lastQuotaAttemptByRoot.set(root, nowForQuota);
      const fetchQuotas = deps?.fetchQuotas ?? fetchProviderAccountQuotas;
      try {
        await fetchQuotas(PROVIDER, true, prov, config);
      } catch {
        // Best-effort refresh; keep cached quotas intact on transient upstream failures.
      }
    }

    const refreshRoster = deps?.refreshAccountRoster ?? refreshAntigravityAccountRosterOnce;
    for (const account of accounts) {
      if (getConfigDir() !== root) break;
      const nowForRoster = currentNow();
      const observedAt = antigravityAccountRosterObservedAt(PROVIDER, account.id);
      const rosterDue = observedAt === undefined || nowForRoster - observedAt >= ANTIGRAVITY_BACKGROUND_ROSTER_REFRESH_MS;
      if (!rosterDue) continue;
      const attemptKey = `${root}\0${account.id}`;
      const lastAttempt = lastRosterAttemptByAccount.get(attemptKey);
      if (lastAttempt !== undefined && nowForRoster - lastAttempt < ANTIGRAVITY_BACKGROUND_FAILURE_BACKOFF_MS) {
        continue;
      }
      lastRosterAttemptByAccount.set(attemptKey, nowForRoster);
      try {
        await refreshRoster({ provider: prov, accountId: account.id, root });
      } catch {
        // One failing sibling must not stop remaining usable accounts from refreshing.
      }
    }
  })()
    .catch(() => {
      // Background refresh is best-effort; live request guards keep running.
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = pass;
  return pass;
}

export function registerAntigravityBackgroundRefreshWorker(config: OcxConfig): () => void {
  return registerStateSweepAfterTick({
    name: "antigravity-background-refresh",
    afterTick: () => {
      void runAntigravityBackgroundRefresh(config);
    },
  });
}

/** Test-only: clear per-root and per-account backoff state and in-flight lock. */
export function clearAntigravityBackgroundRefreshStateForTests(): void {
  inFlight = null;
  lastQuotaAttemptByRoot.clear();
  lastRosterAttemptByAccount.clear();
}
