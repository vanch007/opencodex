import { createHash } from "node:crypto";
import { apiKeyAccountLogLabel } from "../../codex/account-label";
import { getKeyCooldownUntil } from "../../providers/api-key-cooldowns";
export {
  canFallbackGoogleToAntigravity,
  shouldProactivelyFallbackGoogleToAntigravity,
} from "../../providers/key-failover";
import { apiKeyPoolEntryId, maskApiKey } from "../../providers/api-keys";
import type { OcxConfig, OcxUsage } from "../../types";
import { scanUsageLedgerCooperatively } from "../../usage/ledger-scanner";
import { currentUsageLogRevision, usageLogRevisionKey } from "../../usage/log";

export interface AiStudioLocalUsage {
  requestsToday: number;
  hydrogenUsedToday: number;
  flashUsedToday: number;
  argonUsedToday: number;
  tokensToday: number;
  lastUsedAt?: number;
}

export interface AiStudioLocalQuota extends AiStudioLocalUsage {
  entryId: string;
  maskedKey: string;
  planTier: "free" | "pro" | "ultra";
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  hydrogenLimit: number;
  flashLimit: number;
  argonLimit: number;
  remainingPercent: number;
  inCooldown: boolean;
  dailyExhausted: boolean;
  cooldownUntil?: number;
  resetAt: number;
}

export interface StandaloneAiStudioKey {
  entryId: string;
  email: string;
  aiStudioApiKey: string;
  aiStudioQuota: AiStudioLocalQuota;
}

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hour12: false,
});

function pacificParts(ts: number) {
  const parts = pacificFormatter.formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return {
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Epoch ms of 00:00:00 America/Los_Angeles for the day containing `now`. */
export function startOfPacificDayMs(now = Date.now()): number {
  const p = pacificParts(now);
  let guess = Math.floor(now / 1000) * 1000 - ((p.hour * 3600 + p.minute * 60 + p.second) * 1000);
  for (let i = 0; i < 2; i++) {
    const gp = pacificParts(guess);
    const deltaSec = gp.hour * 3600 + gp.minute * 60 + gp.second;
    if (deltaSec === 0) break;
    guess += deltaSec > 43200 ? (86400 - deltaSec) * 1000 : -deltaSec * 1000;
  }
  return guess;
}

/** Epoch ms of the next 00:00:00 America/Los_Angeles after `now`. */
export function nextPacificMidnightMs(now = Date.now()): number {
  const p = pacificParts(now);
  const msUntil = ((24 - p.hour) * 3600 - p.minute * 60 - p.second) * 1000 - (now % 1000);
  let guess = now + (msUntil > 0 ? msUntil : 24 * 3600_000);
  for (let i = 0; i < 2; i++) {
    const gp = pacificParts(guess);
    const deltaSec = gp.hour * 3600 + gp.minute * 60 + gp.second;
    if (deltaSec === 0) break;
    guess += deltaSec > 43200 ? (86400 - deltaSec) * 1000 : -deltaSec * 1000;
  }
  return guess;
}

const CACHE_TTL_MS = 30_000;
let usageCache: {
  key: string;
  expiresAt: number;
  data: Map<string, AiStudioLocalUsage>;
} | null = null;
const usageFlights = new Map<string, Promise<Map<string, AiStudioLocalUsage>>>();

function emptyUsage(): AiStudioLocalUsage {
  return { requestsToday: 0, hydrogenUsedToday: 0, flashUsedToday: 0, argonUsedToday: 0, tokensToday: 0 };
}

function tokenCount(totalTokens: number | undefined, usage: OcxUsage | undefined): number {
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0) return totalTokens;
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** Scan local `usage.jsonl` for Pacific-day per-key Google AI Studio request and token counts. */
export async function readAiStudioLocalUsageSnapshot(
  keys: readonly string[],
  now = Date.now(),
): Promise<Map<string, AiStudioLocalUsage>> {
  const uniqueKeys = [...new Set(keys.map(k => k.trim()).filter(Boolean))];
  if (uniqueKeys.length === 0) return new Map();

  const dayStart = startOfPacificDayMs(now);
  const keysDigest = createHash("sha256").update(JSON.stringify([...uniqueKeys].sort())).digest("hex").slice(0, 16);
  const observed = currentUsageLogRevision();
  const revKey = usageLogRevisionKey(observed);
  const cacheKey = `${revKey}|${dayStart}|${keysDigest}`;

  if (usageCache && usageCache.key === cacheKey && now < usageCache.expiresAt) {
    return usageCache.data;
  }
  const existingFlight = usageFlights.get(cacheKey);
  if (existingFlight) return await existingFlight;

  const flight = (async () => {
    const labelToKeys = new Map<string, string[]>();
    const usageByKey = new Map<string, AiStudioLocalUsage>();
    for (const apiKey of uniqueKeys) {
      usageByKey.set(apiKey, emptyUsage());
      const entryId = apiKeyPoolEntryId(apiKey);
      const labels = [
        apiKeyAccountLogLabel("google", { entryId, reference: apiKey }),
        apiKeyAccountLogLabel("google", { reference: apiKey }),
        apiKeyAccountLogLabel("gemini", { entryId, reference: apiKey }),
        apiKeyAccountLogLabel("gemini", { reference: apiKey }),
      ];
      for (const lbl of labels) {
        if (!lbl) continue;
        const list = labelToKeys.get(lbl);
        if (list) list.push(apiKey);
        else labelToKeys.set(lbl, [apiKey]);
      }
    }

    const recordHit = (
      targetKeys: readonly string[],
      model: string | undefined,
      status: number,
      totalTokens: number | undefined,
      usage: OcxUsage | undefined,
      ts: number,
    ) => {
      if (status < 200 || status >= 400) return;
      const m = (model ?? "").toLowerCase();
      const tokens = tokenCount(totalTokens, usage);
      for (const apiKey of targetKeys) {
        const stats = usageByKey.get(apiKey);
        if (!stats) continue;
        stats.requestsToday += 1;
        if (m.includes("hydrogen")) stats.hydrogenUsedToday += 1;
        else if (m.includes("argon")) stats.argonUsedToday += 1;
        else if (m.includes("flash")) stats.flashUsedToday += 1;
        stats.tokensToday += tokens;
        if (!stats.lastUsedAt || ts > stats.lastUsedAt) stats.lastUsedAt = ts;
      }
    };

    try {
      await scanUsageLedgerCooperatively({
        onEntry(entry) {
          if (typeof entry.timestamp !== "number" || entry.timestamp < dayStart) return;
          let matchedAttempt = false;
          if (Array.isArray(entry.attempts) && entry.attempts.length > 0) {
            for (const attempt of entry.attempts) {
              if (attempt.provider !== "google" && attempt.provider !== "gemini") continue;
              const targetKeys = attempt.accountLogLabel ? labelToKeys.get(attempt.accountLogLabel) : undefined;
              if (!targetKeys) continue;
              matchedAttempt = true;
              recordHit(targetKeys, attempt.model, attempt.status, attempt.totalTokens, attempt.usage, entry.timestamp);
            }
          }
          if (!matchedAttempt && (entry.provider === "google" || entry.provider === "gemini") && entry.accountLogLabel) {
            const targetKeys = labelToKeys.get(entry.accountLogLabel);
            if (targetKeys) {
              recordHit(
                targetKeys,
                entry.servedModel || entry.resolvedModel || entry.model,
                entry.status,
                entry.totalTokens,
                entry.usage,
                entry.timestamp,
              );
            }
          }
        },
      });
    } catch {
      // Best-effort local usage telemetry: return zeroed stats if ledger is unreadable
    }

    usageCache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, data: usageByKey };
    return usageByKey;
  })();

  usageFlights.set(cacheKey, flight);
  try {
    return await flight;
  } finally {
    if (usageFlights.get(cacheKey) === flight) usageFlights.delete(cacheKey);
  }
}

export function aiStudioLimitsForPlan(plan?: string | null) {
  const p = (plan ?? "").toLowerCase();
  if (p.includes("ultra")) {
    return {
      planTier: "ultra" as const,
      dailyRequestLimit: 200,
      dailyTokenLimit: 25_000_000,
      hydrogenLimit: 200,
      flashLimit: 200,
      argonLimit: 200,
    };
  }
  if (p.includes("pro") || p === "g1-pro-tier") {
    return {
      planTier: "pro" as const,
      dailyRequestLimit: 100,
      dailyTokenLimit: 25_000_000,
      hydrogenLimit: 100,
      flashLimit: 150,
      argonLimit: 50,
    };
  }
  return {
    planTier: "free" as const,
    dailyRequestLimit: 50,
    dailyTokenLimit: 10_000_000,
    hydrogenLimit: 50,
    flashLimit: 50,
    argonLimit: 0,
  };
}

export function buildAiStudioLocalQuotaForKey(params: {
  apiKey: string;
  plan?: string | null;
  now?: number;
  usage?: AiStudioLocalUsage;
}): AiStudioLocalQuota {
  const now = params.now ?? Date.now();
  const apiKey = params.apiKey.trim();
  const entryId = apiKeyPoolEntryId(apiKey);
  const limits = aiStudioLimitsForPlan(params.plan);
  const stats = params.usage ?? emptyUsage();
  const resetAt = nextPacificMidnightMs(now);

  const cooldownUntil = getKeyCooldownUntil("google", entryId, now)
    ?? getKeyCooldownUntil("gemini", entryId, now)
    ?? undefined;
  const inCooldown = cooldownUntil !== undefined;
  const dailyExhausted = Boolean(
    (cooldownUntil !== undefined && cooldownUntil >= resetAt - 180_000)
    || (limits.dailyRequestLimit > 0 && stats.requestsToday >= limits.dailyRequestLimit)
    || (limits.dailyTokenLimit > 0 && stats.tokensToday >= limits.dailyTokenLimit),
  );

  const reqPct = limits.dailyRequestLimit > 0 ? (stats.requestsToday / limits.dailyRequestLimit) * 100 : 0;
  const tokPct = limits.dailyTokenLimit > 0 ? (stats.tokensToday / limits.dailyTokenLimit) * 100 : 0;
  const remainingPercent = dailyExhausted
    ? 0
    : Math.max(0, Math.min(100, Math.round(100 - Math.max(reqPct, tokPct))));

  return {
    ...stats,
    ...limits,
    entryId,
    maskedKey: maskApiKey(apiKey),
    remainingPercent,
    inCooldown,
    dailyExhausted,
    ...(cooldownUntil !== undefined ? { cooldownUntil } : {}),
    resetAt,
  };
}

export async function resolveAiStudioPoolQuotas(
  config: OcxConfig,
  accountRows: ReadonlyArray<{ email?: string; plan?: string | null; aiStudioApiKey?: string }>,
  now = Date.now(),
): Promise<{
  quotaByApiKey: Map<string, AiStudioLocalQuota>;
  standaloneAiStudioKeys: StandaloneAiStudioKey[];
}> {
  const pool = config.providers.google?.apiKeyPool ?? [];
  const allKeys: string[] = [];
  for (const row of accountRows) {
    if (typeof row.aiStudioApiKey === "string" && row.aiStudioApiKey.trim()) {
      allKeys.push(row.aiStudioApiKey.trim());
    }
  }
  for (const entry of pool) {
    if (typeof entry.key === "string" && entry.key.trim()) {
      allKeys.push(entry.key.trim());
    }
  }
  const usageMap = await readAiStudioLocalUsageSnapshot(allKeys, now);
  const quotaByApiKey = new Map<string, AiStudioLocalQuota>();
  const oauthKeyEmails = new Set<string>();

  for (const row of accountRows) {
    const apiKey = row.aiStudioApiKey?.trim();
    if (!apiKey) continue;
    if (row.email) oauthKeyEmails.add(row.email.trim().toLowerCase());
    quotaByApiKey.set(apiKey, buildAiStudioLocalQuotaForKey({
      apiKey,
      plan: row.plan,
      now,
      usage: usageMap.get(apiKey),
    }));
  }

  const standaloneAiStudioKeys: StandaloneAiStudioKey[] = [];
  const seenStandaloneEmails = new Set<string>();
  const planByEmail = new Map<string, string | null | undefined>();
  for (const row of accountRows) {
    if (row.email) planByEmail.set(row.email.trim().toLowerCase(), row.plan);
  }
  for (const entry of pool) {
    const label = entry.label?.trim();
    const apiKey = entry.key?.trim();
    if (!label || !label.includes("@") || !apiKey) continue;
    const normEmail = label.toLowerCase();
    if (oauthKeyEmails.has(normEmail) || seenStandaloneEmails.has(normEmail)) continue;
    seenStandaloneEmails.add(normEmail);
    const quota = quotaByApiKey.get(apiKey) ?? buildAiStudioLocalQuotaForKey({
      apiKey,
      plan: planByEmail.get(normEmail) ?? "free",
      now,
      usage: usageMap.get(apiKey),
    });
    quotaByApiKey.set(apiKey, quota);
    standaloneAiStudioKeys.push({
      entryId: entry.id,
      email: label,
      aiStudioApiKey: apiKey,
      aiStudioQuota: quota,
    });
  }

  return { quotaByApiKey, standaloneAiStudioKeys };
}

/**
 * Rebuild `config.providers.google.apiKeyPool` preserving both Antigravity-linked keys
 * and standalone email-labeled keys, optionally updating/removing a standalone email key.
 */
export function syncGoogleApiKeyPool(params: {
  config: OcxConfig;
  antigravityAccounts: ReadonlyArray<{ id: string; alias?: string; email?: string; aiStudioApiKey?: string }>;
  standaloneUpdate?: { email: string; apiKey: string };
}): void {
  const { config, antigravityAccounts, standaloneUpdate } = params;
  const existingPool = config.providers.google?.apiKeyPool ?? [];
  const antigravityEmails = new Set<string>();
  const seenKeys = new Set<string>();
  const pool: Array<{ id: string; key: string; label?: string }> = [];

  for (const acc of antigravityAccounts) {
    const email = acc.email?.trim();
    if (email) antigravityEmails.add(email.toLowerCase());
    const k = acc.aiStudioApiKey?.trim();
    if (!k || seenKeys.has(k)) continue;
    seenKeys.add(k);
    pool.push({
      id: apiKeyPoolEntryId(k),
      key: k,
      label: email || acc.alias || acc.id,
    });
  }

  const updateEmailLower = standaloneUpdate?.email.trim().toLowerCase();
  for (const entry of existingPool) {
    const entryEmailLower = entry.label?.trim().toLowerCase();
    if (entryEmailLower && antigravityEmails.has(entryEmailLower)) continue;
    if (updateEmailLower && entryEmailLower === updateEmailLower) continue;
    const k = entry.key?.trim();
    if (!k || seenKeys.has(k)) continue;
    seenKeys.add(k);
    pool.push({ id: apiKeyPoolEntryId(k), key: k, ...(entry.label ? { label: entry.label } : {}) });
  }

  if (standaloneUpdate && standaloneUpdate.apiKey.trim()) {
    const k = standaloneUpdate.apiKey.trim();
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      pool.push({
        id: apiKeyPoolEntryId(k),
        key: k,
        label: standaloneUpdate.email.trim(),
      });
    }
  }

  if (pool.length > 0) {
    if (!config.providers.google) {
      config.providers.google = {
        adapter: "google",
        baseUrl: "https://generativelanguage.googleapis.com",
        liveModels: false,
        models: [
          "gemini-4-argon",
          "gemini-4-hydrogen",
        ],
        defaultModel: "gemini-4-hydrogen",
      };
    }
    config.providers.google.apiKey = pool[0]!.key;
    config.providers.google.apiKeyPool = pool;
    config.providers.google.requestPacing = {
      enabled: true,
      keySelection: "round-robin",
    };
    config.providers.google.cacheAffinity = "off";
    config.providers.google.showThinkingSummary = true;
    config.providers.google.retryOnReset = {
      enabled: true,
      replacements: 2,
    };
  } else if (config.providers.google?.apiKeyPool) {
    delete config.providers.google.apiKeyPool;
    delete config.providers.google.apiKey;
  }
}

/** Enrich projected OAuth account rows with AI Studio local daily quotas and standalone email keys. */
export async function enrichAntigravityAiStudioPayload<T extends { id: string }>(params: {
  config: OcxConfig;
  accounts: T[];
  fullAccounts: ReadonlyArray<{ id: string; aiStudioApiKey?: string; credential?: { email?: string; plan?: string | null } }>;
  formatEmail: (email: string) => string;
}): Promise<{
  accounts: Array<T & { aiStudioQuota?: AiStudioLocalQuota }>;
  standaloneAiStudioKeys: StandaloneAiStudioKey[];
}> {
  const { config, accounts, fullAccounts, formatEmail } = params;
  const fullById = new Map(fullAccounts.map(a => [a.id, a]));
  const { quotaByApiKey, standaloneAiStudioKeys } = await resolveAiStudioPoolQuotas(
    config,
    fullAccounts.map(a => ({
      email: a.credential?.email,
      plan: a.credential?.plan,
      aiStudioApiKey: a.aiStudioApiKey,
    })),
  );
  return {
    accounts: accounts.map(acc => {
      const full = fullById.get(acc.id);
      const key = full?.aiStudioApiKey?.trim();
      const aiStudioQuota = key ? quotaByApiKey.get(key) : undefined;
      return aiStudioQuota ? { ...acc, aiStudioQuota } : acc;
    }),
    standaloneAiStudioKeys: standaloneAiStudioKeys.map(item => ({
      ...item,
      email: formatEmail(item.email),
    })),
  };
}
