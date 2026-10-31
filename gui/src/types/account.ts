import type { AccountQuota } from "../codex-quota-utils";

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
  paused?: boolean;
  isMain?: boolean;
  expiresAt?: number;
  updatedAt?: number;
  createdAt?: string;
  teamName?: string;
  loginMethod?: string;
  resetCount?: number;
}
