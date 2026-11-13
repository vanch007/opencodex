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

export interface UnifiedAccountItem {
  id: string;
  provider: string; // "google-antigravity" | "openai"
  providerLabel: string;
  email: string;
  alias?: string;
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

/** Gemini 4 Argon + Claude 5.5 are Pro/Ultra only; a free tier never has them, whatever the quota summary lists. */
export function accountHasArgonTier(acc: Pick<UnifiedAccountItem, "plan" | "quota">): boolean {
  if ((acc.plan ?? "").toLowerCase().includes("free")) return false;
  return Boolean(acc.quota?.customWindows?.some(w => /argon/i.test(w.label) || w.modelId === "gemini-4-argon"));
}
