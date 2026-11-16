import type { AccountQuota } from "../codex-quota-utils";

export interface AccountHealthTestState {
  ok: boolean;
  status: number;
  durationMs: number;
  model: string;
  errorCode?: string;
  message: string;
  testedAt: number;
}

export interface AiStudioLocalQuota {
  entryId: string;
  maskedKey: string;
  planTier: "free" | "pro" | "ultra";
  requestsToday: number;
  dailyRequestLimit: number;
  hydrogenUsedToday: number;
  hydrogenLimit: number;
  flashUsedToday: number;
  flashLimit: number;
  argonUsedToday: number;
  argonLimit: number;
  tokensToday: number;
  dailyTokenLimit: number;
  remainingPercent: number;
  inCooldown: boolean;
  dailyExhausted: boolean;
  cooldownUntil?: number;
  resetAt: number;
  lastUsedAt?: number;
}

export interface StandaloneAiStudioKey {
  entryId: string;
  email: string;
  aiStudioApiKey: string;
  aiStudioQuota: AiStudioLocalQuota;
}

export interface UnifiedAccountItem {
  id: string;
  provider: string; // "google-antigravity" | "openai" | "xai"
  providerLabel: string;
  email: string;
  alias?: string;
  aiStudioApiKey?: string;
  aiStudioQuota?: AiStudioLocalQuota | null;
  active: boolean;
  plan?: string;
  quota?: AccountQuota | null;
  quotaMode?: string;
  quotaUnavailable?: boolean;
  quotaPending?: boolean;
  health?: { status: "healthy" | "cooldown" | "reauth_required" | "warning"; reason?: string };
  healthTest?: AccountHealthTestState;
  paused?: boolean;
  isMain?: boolean;
  expiresAt?: number;
  updatedAt?: number;
  createdAt?: string;
  teamName?: string;
  loginMethod?: string;
  resetCount?: number;
}

export interface EmailAccountGroup {
  emailKey: string;
  email: string;
  alias?: string;
  antigravity?: UnifiedAccountItem;
  aiStudio?: {
    apiKey: string;
    quota?: AiStudioLocalQuota | null;
    planTier: "free" | "pro" | "ultra";
    linkedAccountId?: string;
  };
  chatgpt?: UnifiedAccountItem;
  grok?: UnifiedAccountItem;
  anyActive: boolean;
  allPaused: boolean;
  anyUnusable: boolean;
  hasArgon: boolean;
  primaryPlan?: string;
  updatedAt?: number;
  createdAt?: string;
}

/**
 * An account that probes as unusable (banned, revoked, needs re-login) and should be paused.
 * Quota exhaustion (HTTP 429) is NOT unusable: the account is healthy and recovers on reset.
 */
export function accountIsUnusable(acc: Pick<UnifiedAccountItem, "healthTest" | "health">): boolean {
  const failed = acc.healthTest !== undefined && !acc.healthTest.ok && acc.healthTest.status !== 429;
  return failed || acc.health?.status === "reauth_required";
}

/** Gemini 4 Argon + Claude 5.5 are Pro/Ultra only; a free tier never has them, whatever the quota summary lists. */
export function accountHasArgonTier(acc: Pick<UnifiedAccountItem, "plan" | "quota">): boolean {
  if ((acc.plan ?? "").toLowerCase().includes("free")) return false;
  return Boolean(acc.quota?.customWindows?.some(w => /argon/i.test(w.label) || w.modelId === "gemini-4-argon"));
}
