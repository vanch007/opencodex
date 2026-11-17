/** Process-local cooldown and 60s load tracking shared by selection validation and key failover. */
const keyCooldowns = new Map<string, { cooldownUntil: number }>();
const MINUTE_WINDOW_MS = 60_000;
const DEFAULT_CONGESTION_COOLDOWN_MS = 3 * 60_000;
interface MinuteUsageSample {
  at: number;
  requests: number;
  tokens: number;
}
const keyMinuteUsage = new Map<string, MinuteUsageSample[]>();
const aiStudioCongestedUntil = new Map<string, number>();

function cooldownKey(providerName: string, keyId: string): string {
  return `${providerName}\0${keyId}`;
}

function pruneMinuteSamples(key: string, now: number): MinuteUsageSample[] {
  const existing = keyMinuteUsage.get(key);
  if (!existing || existing.length === 0) return [];
  const cutoff = now - MINUTE_WINDOW_MS;
  const fresh = existing.filter(entry => entry.at > cutoff);
  if (fresh.length === 0) {
    keyMinuteUsage.delete(key);
    return [];
  }
  if (fresh.length !== existing.length) {
    keyMinuteUsage.set(key, fresh);
  }
  return fresh;
}

/** Record per-key requests and tokens within a 60-second sliding window. */
export function recordKeyMinuteUsage(
  providerName: string,
  keyId: string,
  tokens: number,
  now = Date.now(),
  requests = 1,
): void {
  const key = cooldownKey(providerName, keyId);
  const fresh = pruneMinuteSamples(key, now);
  fresh.push({
    at: now,
    requests: Math.max(0, Math.round(requests)),
    tokens: Math.max(0, Math.round(tokens)),
  });
  keyMinuteUsage.set(key, fresh);
}

/** Return total requests and tokens recorded for `keyId` in the last 60 seconds. */
export function getKeyMinuteUsage(
  providerName: string,
  keyId: string,
  now = Date.now(),
): { requests: number; tokens: number } {
  const fresh = pruneMinuteSamples(cooldownKey(providerName, keyId), now);
  let requests = 0;
  let tokens = 0;
  for (const sample of fresh) {
    requests += sample.requests;
    tokens += sample.tokens;
  }
  return { requests, tokens };
}

export function setKeyCooldown(providerName: string, keyId: string, cooldownUntil: number): void {
  const key = cooldownKey(providerName, keyId);
  keyCooldowns.set(key, { cooldownUntil: Math.max(keyCooldowns.get(key)?.cooldownUntil ?? 0, cooldownUntil) });
}

export function isKeyInCooldown(providerName: string, keyId: string, now = Date.now()): boolean {
  const entry = keyCooldowns.get(cooldownKey(providerName, keyId));
  if (!entry) return false;
  if (entry.cooldownUntil <= now) {
    keyCooldowns.delete(cooldownKey(providerName, keyId));
    return false;
  }
  return true;
}

export function getKeyCooldownUntil(providerName: string, keyId: string, now = Date.now()): number | null {
  const entry = keyCooldowns.get(cooldownKey(providerName, keyId));
  if (!entry) return null;
  return entry.cooldownUntil > now ? entry.cooldownUntil : null;
}

export function sweepExpiredApiKeyCooldowns(now = Date.now()): number {
  let removed = 0;
  for (const [key, cooldown] of keyCooldowns) {
    if (cooldown.cooldownUntil > now) continue;
    keyCooldowns.delete(key);
    removed += 1;
  }
  for (const key of [...keyMinuteUsage.keys()]) {
    pruneMinuteSamples(key, now);
  }
  return removed;
}

/** Mark an AI Studio model as congested so traffic circuit-breaks to Antigravity briefly. */
export function markAiStudioModelCongested(
  modelId: string,
  now = Date.now(),
  durationMs = DEFAULT_CONGESTION_COOLDOWN_MS,
): void {
  const key = modelId.trim();
  if (!key || !Number.isFinite(durationMs) || durationMs <= 0) return;
  aiStudioCongestedUntil.set(key, now + durationMs);
}

/** Whether direct AI Studio calls for this model recently congested and are still in cooldown. */
export function isAiStudioModelCongested(modelId: string, now = Date.now()): boolean {
  const key = modelId.trim();
  if (!key) return false;
  const until = aiStudioCongestedUntil.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    aiStudioCongestedUntil.delete(key);
    return false;
  }
  return true;
}

/** Manual key management clears this provider's cooldowns and minute-window load state. */
export function clearKeyCooldowns(providerName?: string): void {
  if (!providerName) {
    keyCooldowns.clear();
    keyMinuteUsage.clear();
    aiStudioCongestedUntil.clear();
    return;
  }
  if (providerName === "google") {
    aiStudioCongestedUntil.clear();
  }
  const prefix = `${providerName}\0`;
  for (const key of keyCooldowns.keys()) {
    if (key.startsWith(prefix)) keyCooldowns.delete(key);
  }
  for (const key of keyMinuteUsage.keys()) {
    if (key.startsWith(prefix)) keyMinuteUsage.delete(key);
  }
}
