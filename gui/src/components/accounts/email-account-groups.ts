import {
  accountHasArgonTier,
  accountIsUnusable,
  type EmailAccountGroup,
  type StandaloneAiStudioKey,
  type UnifiedAccountItem,
} from "../../types/account";

function preferAccount(current: UnifiedAccountItem | undefined, candidate: UnifiedAccountItem): UnifiedAccountItem {
  if (!current) return candidate;
  if (candidate.active && !current.active) return candidate;
  if (!candidate.paused && current.paused) return candidate;
  const curTs = Number(current.updatedAt ?? 0);
  const nextTs = Number(candidate.updatedAt ?? 0);
  return nextTs > curTs ? candidate : current;
}

function inferTier(plan?: string | null): "free" | "pro" | "ultra" {
  const p = (plan ?? "").toLowerCase();
  if (p.includes("ultra")) return "ultra";
  if (p.includes("pro") || p === "g1-pro-tier") return "pro";
  return "free";
}

function normalizedEmailKey(email: string, fallbackId: string): string {
  const clean = email.trim().toLowerCase();
  return clean || fallbackId;
}

export function buildEmailAccountGroups(
  accounts: UnifiedAccountItem[],
  standaloneKeys: StandaloneAiStudioKey[] = [],
): EmailAccountGroup[] {
  const map = new Map<string, {
    emailKey: string;
    email: string;
    alias?: string;
    antigravity?: UnifiedAccountItem;
    chatgpt?: UnifiedAccountItem;
    grok?: UnifiedAccountItem;
  }>();

  const ensureGroup = (rawEmail: string, fallbackKey: string) => {
    const key = normalizedEmailKey(rawEmail, fallbackKey);
    let g = map.get(key);
    if (!g) {
      g = { emailKey: key, email: rawEmail.trim() || fallbackKey };
      map.set(key, g);
    } else if (rawEmail.trim() && (!g.email || g.email === g.emailKey)) {
      g.email = rawEmail.trim();
    }
    return g;
  };

  for (const acc of accounts) {
    const g = ensureGroup(acc.email, `${acc.provider}:${acc.id}`);
    if (!g.alias && acc.alias) g.alias = acc.alias;
    if (acc.provider === "google-antigravity") {
      g.antigravity = preferAccount(g.antigravity, acc);
    } else if (acc.provider === "openai") {
      g.chatgpt = preferAccount(g.chatgpt, acc);
    } else if (acc.provider === "xai") {
      g.grok = preferAccount(g.grok, acc);
    }
  }

  const standaloneByEmail = new Map<string, StandaloneAiStudioKey>();
  for (const sk of standaloneKeys) {
    const key = normalizedEmailKey(sk.email, `aistudio:${sk.entryId}`);
    standaloneByEmail.set(key, sk);
    ensureGroup(sk.email, `aistudio:${sk.entryId}`);
  }

  const groups: EmailAccountGroup[] = [];
  for (const g of map.values()) {
    const slots = [g.antigravity, g.chatgpt, g.grok].filter((x): x is UnifiedAccountItem => Boolean(x));
    const standalone = standaloneByEmail.get(g.emailKey);
    const agKey = g.antigravity?.aiStudioApiKey?.trim();
    const apiKey = agKey || standalone?.aiStudioApiKey?.trim();
    const aiStudio = apiKey
      ? {
          apiKey,
          quota: g.antigravity?.aiStudioQuota ?? standalone?.aiStudioQuota ?? null,
          planTier: inferTier(g.antigravity?.plan ?? g.chatgpt?.plan),
          linkedAccountId: g.antigravity?.id,
        }
      : undefined;

    const anyActive = slots.some(a => a.active);
    const allPaused = slots.length > 0 && slots.every(a => Boolean(a.paused));
    const anyUnusable = slots.some(a => !a.paused && accountIsUnusable(a));
    const hasArgon = g.antigravity ? accountHasArgonTier(g.antigravity) : false;
    const primaryPlan = g.antigravity?.plan ?? g.chatgpt?.plan ?? g.grok?.plan;

    const updatedNums = [
      ...slots.map(a => Number(a.updatedAt ?? 0)),
      Number(aiStudio?.quota?.lastUsedAt ?? 0),
    ].filter(n => Number.isFinite(n) && n > 0);
    const updatedAt = updatedNums.length > 0 ? Math.max(...updatedNums) : undefined;
    const createdAt = slots.map(a => a.createdAt).find(Boolean);

    groups.push({
      emailKey: g.emailKey,
      email: g.email,
      alias: g.alias ?? g.antigravity?.alias ?? g.chatgpt?.alias ?? g.grok?.alias,
      antigravity: g.antigravity,
      aiStudio,
      chatgpt: g.chatgpt,
      grok: g.grok,
      anyActive,
      allPaused,
      anyUnusable,
      hasArgon,
      primaryPlan,
      updatedAt,
      createdAt,
    });
  }
  return groups;
}

export interface EmailGroupStats {
  total: number;
  antigravityCount: number;
  aiStudioCount: number;
  chatgptCount: number;
  grokCount: number;
  pro: number;
  free: number;
  ultra: number;
  plus: number;
  argon: number;
  flash: number;
}

export function computeEmailGroupStats(groups: EmailAccountGroup[]): EmailGroupStats {
  let antigravityCount = 0;
  let aiStudioCount = 0;
  let chatgptCount = 0;
  let grokCount = 0;
  let pro = 0, free = 0, ultra = 0, plus = 0, argon = 0, flash = 0;

  for (const g of groups) {
    if (g.antigravity) antigravityCount += 1;
    if (g.aiStudio) aiStudioCount += 1;
    if (g.chatgpt) chatgptCount += 1;
    if (g.grok) grokCount += 1;

    const plans = [g.antigravity?.plan, g.chatgpt?.plan, g.grok?.plan].filter(Boolean).map(s => String(s).toLowerCase());
    if (plans.some(p => p.includes("pro") || p === "g1-pro-tier")) pro += 1;
    else if (plans.some(p => p.includes("ultra"))) ultra += 1;
    else if (plans.some(p => p.includes("plus"))) plus += 1;
    else if (plans.some(p => p.includes("free"))) free += 1;

    if (g.antigravity) {
      if (g.hasArgon) argon += 1;
      else flash += 1;
    }
  }

  return {
    total: groups.length,
    antigravityCount,
    aiStudioCount,
    chatgptCount,
    grokCount,
    pro,
    free,
    ultra,
    plus,
    argon,
    flash,
  };
}

function groupRemainingScore(g: EmailAccountGroup): number {
  const scores: number[] = [];
  if (g.antigravity) {
    const wins = g.antigravity.quota?.customWindows ?? [];
    if (wins.length > 0) {
      const avg = wins.reduce((sum, w) => sum + Math.max(0, 100 - (w.percent ?? 0)), 0) / wins.length;
      scores.push(avg);
    }
  }
  if (g.aiStudio?.quota) scores.push(g.aiStudio.quota.remainingPercent);
  if (g.chatgpt?.quota) {
    const used = g.chatgpt.quota.monthlyPercent ?? g.chatgpt.quota.weeklyPercent ?? 0;
    scores.push(Math.max(0, 100 - used));
  }
  if (g.grok?.quota) {
    scores.push(Math.max(0, 100 - (g.grok.quota.weeklyPercent ?? 0)));
  }
  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

export function filterAndSortEmailGroups(
  groups: EmailAccountGroup[],
  options: {
    searchQuery: string;
    statusFilter: string;
    planFilter: string;
    sortBy: "quota" | "reset" | "email";
    sortOrder: "asc" | "desc";
  },
): EmailAccountGroup[] {
  const { searchQuery, statusFilter, planFilter, sortBy, sortOrder } = options;
  return groups
    .filter(g => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hit = g.email.toLowerCase().includes(q)
          || (g.alias ?? "").toLowerCase().includes(q)
          || g.antigravity?.id.toLowerCase().includes(q)
          || g.chatgpt?.id.toLowerCase().includes(q)
          || g.grok?.id.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (statusFilter === "active" && !g.anyActive) return false;
      if (statusFilter === "ready" && (g.allPaused || g.anyActive || g.anyUnusable)) return false;
      if (statusFilter === "unusable" && !g.anyUnusable) return false;
      if (statusFilter === "paused" && !g.allPaused) return false;
      if (statusFilter === "reauth") {
        const needsReauth = [g.antigravity, g.chatgpt, g.grok].some(a => a?.health?.status === "reauth_required");
        if (!needsReauth) return false;
      }
      if (statusFilter === "has-aistudio" && !g.aiStudio) return false;
      if (statusFilter === "no-aistudio" && Boolean(g.aiStudio)) return false;
      if (statusFilter === "has-chatgpt" && !g.chatgpt) return false;
      if (statusFilter === "has-grok" && !g.grok) return false;

      if (planFilter !== "all") {
        const plans = [g.antigravity?.plan, g.chatgpt?.plan, g.grok?.plan].filter(Boolean).map(s => String(s).toLowerCase());
        if (planFilter === "pro" && !plans.some(p => p.includes("pro") || p === "g1-pro-tier")) return false;
        if (planFilter === "free" && !plans.some(p => p.includes("free"))) return false;
        if (planFilter === "ultra" && !plans.some(p => p.includes("ultra"))) return false;
        if (planFilter === "plus" && !plans.some(p => p.includes("plus"))) return false;
        if (planFilter === "argon" && !g.hasArgon) return false;
        if (planFilter === "flash" && (!g.antigravity || g.hasArgon)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let diff: number;
      if (sortBy === "email") {
        diff = a.email.localeCompare(b.email);
      } else if (sortBy === "reset") {
        const firstReset = (g: EmailAccountGroup) =>
          g.antigravity?.quota?.customWindows?.[0]?.resetAt
          ?? g.aiStudio?.quota?.resetAt
          ?? g.chatgpt?.quota?.monthlyResetAt
          ?? g.grok?.quota?.weeklyResetAt
          ?? 0;
        diff = firstReset(a) - firstReset(b);
      } else {
        if (a.anyActive && !b.anyActive) return -1;
        if (!a.anyActive && b.anyActive) return 1;
        diff = groupRemainingScore(b) - groupRemainingScore(a);
      }
      return sortOrder === "asc" ? -diff : diff;
    });
}

export function formatCompactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 10_000) return `${Math.round(tokens)}`;
  return `${(tokens / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
}

export function quotaToneClasses(remainingPercent: number): { text: string; bar: string } {
  if (remainingPercent < 20) return { text: "ag-quota-pct--danger", bar: "ag-quota-bar-fill--danger" };
  if (remainingPercent < 50) return { text: "ag-quota-pct--warn", bar: "ag-quota-bar-fill--warn" };
  return { text: "ag-quota-pct--healthy", bar: "ag-quota-bar-fill--healthy" };
}

interface RawOAuthAccountRow {
  id: string;
  email?: string;
  alias?: string;
  aiStudioApiKey?: string;
  aiStudioQuota?: UnifiedAccountItem["aiStudioQuota"];
  active?: boolean;
  plan?: string;
  quota?: UnifiedAccountItem["quota"];
  quotaMode?: string;
  quotaUnavailable?: boolean;
  quotaPending?: boolean;
  health?: UnifiedAccountItem["health"];
  paused?: boolean;
  expiresAt?: number;
  updatedAt?: number;
  createdAt?: string;
}

interface RawCodexAccountRow {
  id: string;
  email?: string;
  logLabel?: string;
  alias?: string;
  paused?: boolean;
  isMain?: boolean;
  plan?: string;
  quota?: UnifiedAccountItem["quota"];
  health?: UnifiedAccountItem["health"];
  createdAt?: string;
}

export function mapOAuthAccountItem(
  provider: string,
  acc: RawOAuthAccountRow,
  activeAccountId?: string | null,
): UnifiedAccountItem {
  const isXai = provider === "xai";
  return {
    id: acc.id,
    provider,
    providerLabel: provider === "google-antigravity" ? "Google Antigravity" : isXai ? "xAI Grok" : provider,
    email: acc.email || (isXai ? (acc.alias ? `${acc.alias}@x.ai` : `grok-${String(acc.id).slice(0, 8)}@x.ai`) : ""),
    alias: acc.alias,
    aiStudioApiKey: acc.aiStudioApiKey,
    aiStudioQuota: acc.aiStudioQuota ?? null,
    active: acc.active === true || acc.id === activeAccountId,
    plan: acc.plan ?? (isXai ? "free" : "free-tier"),
    quota: acc.quota ?? null,
    quotaMode: acc.quotaMode,
    quotaUnavailable: acc.quotaUnavailable,
    quotaPending: acc.quotaPending,
    health: acc.health,
    paused: acc.paused,
    expiresAt: acc.expiresAt,
    updatedAt: acc.quota?.updatedAt ?? acc.updatedAt,
    createdAt: acc.createdAt,
    teamName: isXai ? "xAI 官方账户" : undefined,
    loginMethod: isXai ? "xAI OAuth 授权" : undefined,
  };
}

export function mapCodexAccountItem(acc: RawCodexAccountRow): UnifiedAccountItem {
  return {
    id: acc.id,
    provider: "openai",
    providerLabel: "OpenAI / Codex",
    email: acc.email ?? "",
    alias: acc.logLabel || acc.alias,
    active: !acc.paused && Boolean(acc.isMain),
    plan: acc.plan ?? "free",
    quota: acc.quota ?? null,
    health: acc.health,
    paused: acc.paused,
    isMain: acc.isMain,
    updatedAt: acc.quota?.updatedAt,
    createdAt: acc.createdAt,
    teamName: "个人账户",
    loginMethod: "使用 Google 登录",
    resetCount: 0,
  };
}

export function sanitizeAiStudioKeyInput(raw: string): string {
  let s = raw.trim().replace(/^["'`]|["'`]$/g, "").trim();
  s = s.replace(/^(?:(?:api_?key|key|token)\s*[:=]\s*|bearer\s+)/i, "").trim();
  return s.replace(/^["'`]|["'`]$/g, "").trim();
}

export function maskEmailLabel(email: string, showSensitive: boolean): string {
  if (!email) return "Unknown";
  if (showSensitive) return email;
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  const name = parts[0]!;
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : `${name}*`;
  return `${maskedName}@${parts[1]}`;
}
