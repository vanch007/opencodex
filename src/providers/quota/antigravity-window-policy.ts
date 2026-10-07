import type { ProviderQuota } from "../quota-types";

const WEEK_MS = 7 * 24 * 60 * 60_000;

export function antigravityWindowMatchesFamily(label: string, family: "gem" | "cla"): boolean {
  const token = label.trim().split(/[\s(/]+/)[0] ?? "";
  return family === "gem" ? /^gem(?:ini)?$/i.test(token) : /^cla(?:ude)?$/i.test(token);
}

/** A live weekly deadline proves activation; a models-fallback reset alone does not. */
export function antigravityActiveWeeklyResetAt(
  quota: ProviderQuota | null | undefined,
  family?: "gem" | "cla",
  now = Date.now(),
): number | null {
  if (!quota) return null;
  const resets = (quota.customWindows ?? [])
    .filter(window => /\bweekly\b/i.test(window.label)
      && (!family || antigravityWindowMatchesFamily(window.label, family)))
    .map(window => window.resetAt);
  resets.push(quota.weeklyResetAt);
  const active = resets.filter((resetAt): resetAt is number => typeof resetAt === "number"
    && Number.isFinite(resetAt) && resetAt > now && resetAt <= now + WEEK_MS);
  return active.length ? Math.min(...active) : null;
}
