import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accountIsUnusable, type EmailAccountGroup, type StandaloneAiStudioKey, type UnifiedAccountItem } from "../types/account";
import { confirmAction, requestTextValue } from "../action-dialogs";
import AddCodexAccountModal from "../components/AddCodexAccountModal";
import { useCopyFeedback } from "../components/use-copy-feedback";
import { CockpitAccountCard } from "../components/accounts/CockpitAccountCard";
import { CockpitHeader } from "../components/accounts/CockpitHeader";
import { CockpitToolbar } from "../components/accounts/CockpitToolbar";
import { AccountTipLayer } from "../components/accounts/AccountTipLayer";
import { CockpitHealthTable } from "../components/accounts/CockpitHealthTable";
import {
  buildEmailAccountGroups,
  computeEmailGroupStats,
  filterAndSortEmailGroups,
  mapCodexAccountItem,
  mapOAuthAccountItem,
  maskEmailLabel,
  sanitizeAiStudioKeyInput,
} from "../components/accounts/email-account-groups";
import { IconPlus, IconRefresh, IconUser } from "../icons";
import { useAccountsOAuth } from "../components/accounts/use-accounts-oauth";
import { AccountsOAuthStatus } from "../components/accounts/AccountsOAuthStatus";

export default function Accounts({ apiBase, pollIntervalMs }: { apiBase: string; pollIntervalMs?: number }) {
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<UnifiedAccountItem[]>([]);
  const [standaloneAiStudioKeys, setStandaloneAiStudioKeys] = useState<StandaloneAiStudioKey[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"quota" | "reset" | "email">("quota");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [showSensitive, setShowSensitive] = useState(false);
  const [sensitiveBusy, setSensitiveBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"overview" | "instances" | "tasks" | "health">("overview");
  const [testingHealthIds, setTestingHealthIds] = useState<Set<string>>(new Set());
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [isBatchPausing, setIsBatchPausing] = useState(false);
  const [showAddCodexModal, setShowAddCodexModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [infoModalGroup, setInfoModalGroup] = useState<EmailAccountGroup | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const { outcomeFor, copy } = useCopyFeedback<string>();

  useEffect(() => {
    if (!showAddMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showAddMenu]);

  // Two-phase load across all OAuth providers and Codex/ChatGPT accounts.
  const loadAccounts = useCallback(async (refresh = false) => {
    const refreshParam = refresh ? "&refresh=1" : "";
    type OAuthAccountRow = Parameters<typeof mapOAuthAccountItem>[1];
    type CodexAccountRow = Parameters<typeof mapCodexAccountItem>[0];
    const mapOAuth = (p: string, data: { activeAccountId?: string | null; accounts?: OAuthAccountRow[] }): UnifiedAccountItem[] =>
      (data.accounts ?? []).map(acc => mapOAuthAccountItem(p, acc, data.activeAccountId));
    const mapCodex = (data: { accounts?: CodexAccountRow[] }): UnifiedAccountItem[] =>
      (data.accounts ?? []).map(mapCodexAccountItem);
    const getJson = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await fetch(url);
        return res.ok ? await res.json() as T : null;
      } catch {
        return null;
      }
    };

    const provData = await getJson<{ providers?: string[] }>(`${apiBase}/api/oauth/providers`);
    const oauthProviders = provData?.providers ?? ["google-antigravity"];

    type OAuthData = {
      activeAccountId?: string | null;
      accounts?: OAuthAccountRow[];
      standaloneAiStudioKeys?: StandaloneAiStudioKey[];
    };
    const [plainLists, plainCodex] = await Promise.all([
      Promise.all(oauthProviders.map(p => getJson<OAuthData>(`${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(p)}`))),
      getJson<{ accounts?: CodexAccountRow[] }>(`${apiBase}/api/codex-auth/accounts`),
    ]);

    const plain: UnifiedAccountItem[] = [];
    oauthProviders.forEach((p, i) => {
      const d = plainLists[i];
      if (!d) return;
      plain.push(...mapOAuth(p, d));
      if (p === "google-antigravity" && Array.isArray(d.standaloneAiStudioKeys)) {
        setStandaloneAiStudioKeys(d.standaloneAiStudioKeys);
      }
    });
    if (plainCodex) plain.push(...mapCodex(plainCodex));

    setAccounts(prev => {
      const old = new Map(prev.map(a => [`${a.provider}:${a.id}`, a]));
      return plain.map(a => {
        const before = old.get(`${a.provider}:${a.id}`);
        if (!a.quota && before?.quota) {
          return {
            ...a,
            quota: before.quota,
            aiStudioQuota: a.aiStudioQuota ?? before.aiStudioQuota ?? null,
            updatedAt: before.updatedAt ?? a.updatedAt,
          };
        }
        return {
          ...a,
          aiStudioQuota: a.aiStudioQuota ?? before?.aiStudioQuota ?? null,
          quotaPending: a.quotaMode === "probe" ? !before?.quota : a.quotaPending,
        };
      });
    });
    setLoading(false);

    const merge = (provider: string, fresh: UnifiedAccountItem[]) => setAccounts(prev => {
      const byId = new Map(fresh.map(a => [a.id, a]));
      return prev.map(a => (a.provider === provider && byId.has(a.id) ? { ...byId.get(a.id)!, quotaPending: false } : a));
    });
    await Promise.all(oauthProviders.map(async p => {
      const d = await getJson<OAuthData>(`${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(p)}&quota=1${refreshParam}`);
      if (d) {
        merge(p, mapOAuth(p, d));
        if (p === "google-antigravity" && Array.isArray(d.standaloneAiStudioKeys)) {
          setStandaloneAiStudioKeys(d.standaloneAiStudioKeys);
        }
      } else {
        setAccounts(prev => prev.map(a => (a.provider === p ? { ...a, quotaPending: false } : a)));
      }
    }));
  }, [apiBase]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const oauth = useAccountsOAuth({
    apiBase,
    accounts,
    pollIntervalMs,
    onOpenCodexModal: () => setShowAddCodexModal(true),
    onCopyEmail: email => copy(email, `oauth-email-${email}`),
    onAccountsChanged: () => loadAccounts(true),
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/api/settings`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then((s: { maskEmails?: unknown } | null) => {
        if (s && typeof s.maskEmails === "boolean") setShowSensitive(!s.maskEmails);
      })
      .catch(() => { /* keep masked */ });
    return () => controller.abort();
  }, [apiBase]);

  const handleToggleSensitive = async () => {
    if (sensitiveBusy) return;
    setSensitiveBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maskEmails: showSensitive }),
      });
      if (res.ok) {
        const s = await res.json() as { maskEmails?: unknown };
        if (typeof s.maskEmails === "boolean") setShowSensitive(!s.maskEmails);
        await loadAccounts();
      }
    } finally {
      setSensitiveBusy(false);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await loadAccounts(true);
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleSwitchAccount = async (item: UnifiedAccountItem) => {
    if (item.active || switchingId) return;
    setSwitchingId(item.id);
    try {
      if (item.provider === "openai") {
        await fetch(`${apiBase}/api/codex-auth/active`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });
      } else {
        await fetch(`${apiBase}/api/oauth/accounts/active`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: item.provider, accountId: item.id }),
        });
      }
      await loadAccounts();
    } finally {
      setSwitchingId(null);
    }
  };

  const handleRefreshAccount = async (item: UnifiedAccountItem) => {
    if (refreshingId) return;
    setRefreshingId(item.id);
    try {
      if (item.provider === "openai") {
        await fetch(`${apiBase}/api/codex-auth/accounts/refresh`, { method: "POST" });
      } else {
        await fetch(`${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(item.provider)}&quota=1&refresh=1`);
      }
      await loadAccounts();
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshGroup = async (group: EmailAccountGroup) => {
    const primary = group.antigravity ?? group.chatgpt ?? group.grok;
    if (!primary || refreshingId) {
      await loadAccounts(true);
      return;
    }
    setRefreshingId(primary.id);
    try {
      const tasks: Array<Promise<unknown>> = [];
      if (group.antigravity) tasks.push(fetch(`${apiBase}/api/oauth/accounts?provider=google-antigravity&quota=1&refresh=1`));
      if (group.grok) tasks.push(fetch(`${apiBase}/api/oauth/accounts?provider=xai&quota=1&refresh=1`));
      if (group.chatgpt) tasks.push(fetch(`${apiBase}/api/codex-auth/accounts/refresh`, { method: "POST" }));
      await Promise.all(tasks);
      await loadAccounts();
    } finally {
      setRefreshingId(null);
    }
  };

  const handleEditAlias = async (item: UnifiedAccountItem) => {
    const newAlias = await requestTextValue({
      message: "设置账号备注 / 别名（例如：工作主号、备用1）",
      initialValue: item.alias ?? "",
    });
    if (newAlias === null) return;
    if (item.provider === "openai") {
      await fetch(`${apiBase}/api/codex-auth/accounts/alias`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, alias: newAlias.trim() }),
      });
    } else {
      await fetch(`${apiBase}/api/oauth/accounts/alias`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: item.provider, accountId: item.id, alias: newAlias.trim() }),
      });
    }
    await loadAccounts();
  };

  const handleEditAiStudioKeyForGroup = async (group: EmailAccountGroup) => {
    const entered = await requestTextValue({
      message: `为邮箱 ${group.email} 关联 Google AI Studio API Key。\n清空内容并保存即可解除关联：`,
      initialValue: group.aiStudio?.apiKey ?? "",
      confirmLabel: "保存关联",
      validate: (val) => {
        const cleaned = sanitizeAiStudioKeyInput(val);
        if (!cleaned) return null;
        if (cleaned.length < 20) {
          return "API Key 长度过短（通常约 39 位字符），请检查是否完整复制";
        }
        if (/[\s\x00-\x1f\x7f]/.test(cleaned)) {
          return "API Key 包含非法空格或控制字符，请检查复制内容";
        }
        return null;
      },
    });
    if (entered === null) return;
    const cleanKey = sanitizeAiStudioKeyInput(entered);

    try {
      const res = await fetch(`${apiBase}/api/oauth/accounts/ai-studio-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google-antigravity",
          ...(group.antigravity ? { accountId: group.antigravity.id } : { email: group.email }),
          apiKey: cleanKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`保存失败: ${err.error || res.statusText}`);
        return;
      }
      await loadAccounts(true);
    } catch (e) {
      alert(`保存请求失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRemoveGroup = async (group: EmailAccountGroup) => {
    const channels: string[] = [];
    if (group.antigravity) channels.push("Antigravity");
    if (group.aiStudio && !group.antigravity) channels.push("AI Studio Key");
    if (group.chatgpt) channels.push("ChatGPT");
    if (group.grok) channels.push("Grok");
    if (channels.length === 0) return;

    const ok = await confirmAction({
      message: `确定要移除邮箱 ${group.email} 下的 ${channels.join("、")} 配置吗？移除后对应平台需重新登录或关联。`,
      confirmLabel: "确认移除",
      tone: "danger",
    });
    if (!ok) return;

    const tasks: Array<Promise<unknown>> = [];
    if (group.antigravity) {
      tasks.push(fetch(`${apiBase}/api/oauth/accounts?provider=google-antigravity&id=${encodeURIComponent(group.antigravity.id)}`, { method: "DELETE" }));
    }
    if (group.grok) {
      tasks.push(fetch(`${apiBase}/api/oauth/accounts?provider=xai&id=${encodeURIComponent(group.grok.id)}`, { method: "DELETE" }));
    }
    if (group.chatgpt) {
      tasks.push(fetch(`${apiBase}/api/codex-auth/accounts?id=${encodeURIComponent(group.chatgpt.id)}`, { method: "DELETE" }));
    }
    if (group.aiStudio && !group.antigravity) {
      tasks.push(fetch(`${apiBase}/api/oauth/accounts/ai-studio-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google-antigravity", email: group.email, apiKey: "" }),
      }));
    }
    await Promise.all(tasks);
    await loadAccounts(true);
  };

  const handleRemovePlatform = async (
    group: EmailAccountGroup,
    platform: "antigravity" | "aiStudio" | "chatgpt" | "grok",
  ) => {
    const labels: Record<string, string> = {
      antigravity: "Antigravity",
      aiStudio: "AI Studio Key",
      chatgpt: "ChatGPT",
      grok: "Grok",
    };
    const ok = await confirmAction({
      message: `确定要移除 ${group.email} 的 ${labels[platform]} 授权吗？移除后需重新登录或关联。`,
      confirmLabel: "确认移除",
      tone: "danger",
    });
    if (!ok) return;

    if (platform === "antigravity" && group.antigravity) {
      await fetch(
        `${apiBase}/api/oauth/accounts?provider=google-antigravity&id=${encodeURIComponent(group.antigravity.id)}`,
        { method: "DELETE" },
      );
    } else if (platform === "chatgpt" && group.chatgpt) {
      await fetch(
        `${apiBase}/api/codex-auth/accounts?id=${encodeURIComponent(group.chatgpt.id)}`,
        { method: "DELETE" },
      );
    } else if (platform === "grok" && group.grok) {
      await fetch(
        `${apiBase}/api/oauth/accounts?provider=xai&id=${encodeURIComponent(group.grok.id)}`,
        { method: "DELETE" },
      );
    } else if (platform === "aiStudio") {
      await fetch(`${apiBase}/api/oauth/accounts/ai-studio-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google-antigravity", email: group.email, apiKey: "" }),
      });
    }
    await loadAccounts(true);
  };

  const handleTestAccountHealth = async (item: UnifiedAccountItem, model?: string) => {
    if (testingHealthIds.has(item.id)) return;
    setTestingHealthIds(prev => new Set(prev).add(item.id));
    try {
      const res = await fetch(`${apiBase}/api/oauth/accounts/test-health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: item.provider, accountId: item.id, model }),
      });
      if (res.ok) {
        const result = (await res.json()) as {
          ok: boolean;
          status: number;
          durationMs: number;
          model: string;
          errorCode?: string;
          message: string;
          paused?: boolean;
        };
        const nextPaused = result.ok
          ? (result.paused ?? false)
          : (result.paused ?? (result.status === 403 || result.status === 401 ? true : undefined));
        setAccounts(prev =>
          prev.map(a =>
            a.id === item.id && a.provider === item.provider
              ? {
                  ...a,
                  paused: nextPaused ?? a.paused,
                  health: {
                    status: result.ok
                      ? "healthy"
                      : result.status === 403 || result.status === 401
                        ? "reauth_required"
                        : "warning",
                    reason: result.errorCode,
                  },
                  healthTest: { ...result, testedAt: Date.now() },
                }
              : a,
          ),
        );
      }
    } catch {
      // ignore
    } finally {
      setTestingHealthIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleTogglePauseAccount = async (item: UnifiedAccountItem, paused: boolean) => {
    if (pausingId) return;
    setPausingId(item.id);
    try {
      const url = item.provider === "openai" ? `${apiBase}/api/codex-auth/accounts/pause` : `${apiBase}/api/oauth/accounts/pause`;
      const body = item.provider === "openai" ? { id: item.id, paused } : { provider: item.provider, accountId: item.id, paused };
      await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setAccounts(prev => prev.map(a => (a.id === item.id && a.provider === item.provider ? { ...a, paused } : a)));
    } finally {
      setPausingId(null);
    }
  };

  const emailGroups = useMemo(
    () => buildEmailAccountGroups(accounts, standaloneAiStudioKeys),
    [accounts, standaloneAiStudioKeys],
  );
  const groupStats = useMemo(() => computeEmailGroupStats(emailGroups), [emailGroups]);
  const displayedGroups = useMemo(
    () => filterAndSortEmailGroups(emailGroups, { searchQuery, statusFilter, planFilter, sortBy, sortOrder }),
    [emailGroups, searchQuery, statusFilter, planFilter, sortBy, sortOrder],
  );

  const handlePauseAllUnusable = async () => {
    if (isBatchPausing) return;
    const targets: UnifiedAccountItem[] = [];
    for (const g of displayedGroups) {
      for (const acc of [g.antigravity, g.grok, g.chatgpt]) {
        if (acc && !acc.paused && accountIsUnusable(acc)) targets.push(acc);
      }
    }
    if (targets.length === 0) return;
    setIsBatchPausing(true);
    try {
      await Promise.all(
        targets.map(a => {
          const url = a.provider === "openai" ? `${apiBase}/api/codex-auth/accounts/pause` : `${apiBase}/api/oauth/accounts/pause`;
          const body = a.provider === "openai" ? { id: a.id, paused: true } : { provider: a.provider, accountId: a.id, paused: true };
          return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        }),
      );
      const unusableSet = new Set(targets.map(a => `${a.provider}:${a.id}`));
      setAccounts(prev => prev.map(a => (unusableSet.has(`${a.provider}:${a.id}`) ? { ...a, paused: true } : a)));
    } finally {
      setIsBatchPausing(false);
    }
  };

  const handleTestAllAccountsHealth = async () => {
    if (isTestingAll || displayedGroups.length === 0) return;
    const probeTargets = displayedGroups
      .map(g => g.antigravity ?? g.grok)
      .filter((x): x is UnifiedAccountItem => Boolean(x));
    if (probeTargets.length === 0) return;
    setIsTestingAll(true);
    try {
      const queue = [...probeTargets];
      while (queue.length > 0) {
        const batch = queue.splice(0, 3);
        await Promise.all(batch.map(acc => handleTestAccountHealth(acc)));
      }
    } finally {
      setIsTestingAll(false);
    }
  };

  const handleAddOAuthAccount = (provider: string, forEmail?: string) => {
    setShowAddMenu(false);
    void oauth.requestAddOAuthAccount(provider, forEmail);
  };

  const handleExportGroup = (group: EmailAccountGroup) => {
    void copy(JSON.stringify(group, null, 2), `export-${group.emailKey}`);
  };

  const handleExportAll = () => {
    const jsonStr = JSON.stringify(emailGroups, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opencodex-email-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedGroups.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedGroups.map(g => g.emailKey)));
    }
  };

  const toggleSelectOne = (emailKey: string) => {
    const next = new Set(selectedIds);
    if (next.has(emailKey)) next.delete(emailKey);
    else next.add(emailKey);
    setSelectedIds(next);
  };

  const formatDisplayEmail = (email: string) => maskEmailLabel(email, showSensitive);

  return (
    <div className="cockpit-accounts-page">
      <AccountTipLayer />
      <CockpitHeader
        emailCount={groupStats.total}
        antigravityCount={groupStats.antigravityCount}
        aiStudioCount={groupStats.aiStudioCount}
        chatgptCount={groupStats.chatgptCount}
        grokCount={groupStats.grokCount}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
      />

      <div style={{ position: "relative" }} ref={addMenuRef}>
        <CockpitToolbar
          searchQuery={searchQuery}
          viewMode={viewMode}
          statusFilter={statusFilter}
          planFilter={planFilter}
          sortBy={sortBy}
          sortOrder={sortOrder}
          showSensitive={showSensitive}
          sensitiveBusy={sensitiveBusy}
          refreshingAll={refreshingAll}
          totalDisplayed={displayedGroups.length}
          selectedCount={selectedIds.size}
          isAllSelected={displayedGroups.length > 0 && selectedIds.size === displayedGroups.length}
          planCounts={groupStats}
          onSearchChange={setSearchQuery}
          onViewModeChange={setViewMode}
          onStatusFilterChange={setStatusFilter}
          onPlanFilterChange={setPlanFilter}
          onSortByChange={setSortBy}
          onToggleSortOrder={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          onToggleSensitive={() => void handleToggleSensitive()}
          onRefreshAll={() => void handleRefreshAll()}
          onAddAccount={() => setShowAddMenu(!showAddMenu)}
          onToggleSelectAll={toggleSelectAll}
          onExportAll={handleExportAll}
          onOpenFolder={() => window.alert("OpenCodex 配置文件及数据存储位于本地目录：~/.opencodex")}
          onOpenSettings={() => { window.location.hash = "#settings"; }}
        />

        {showAddMenu && (
          <div className="cockpit-add-menu">
            <button
              type="button"
              className="cockpit-dropdown-item"
              onClick={() => void handleAddOAuthAccount("google-antigravity")}
              disabled={oauth.oauthBusyProvider !== null}
            >
              <span>添加 Google Antigravity</span>
            </button>
            <button
              type="button"
              className="cockpit-dropdown-item"
              onClick={() => void handleAddOAuthAccount("openai")}
            >
              <span>添加 ChatGPT / Codex</span>
            </button>
            <button
              type="button"
              className="cockpit-dropdown-item"
              onClick={() => void handleAddOAuthAccount("xai")}
              disabled={oauth.oauthBusyProvider !== null}
            >
              <span>添加 xAI Grok</span>
            </button>
          </div>
        )}
      </div>

      <AccountsOAuthStatus oauth={oauth} />

      {loading ? (
        <div className="cockpit-empty">
          <IconRefresh className="spin" style={{ width: 28, height: 28 }} />
          <span>正在加载邮箱聚合配额数据...</span>
        </div>
      ) : activeTab === "instances" ? (
        <div className="cockpit-instances-card">
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🗂 多开实例已就绪</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            当前 OpenCodex 本地代理实例运行于 <code>http://localhost:10100</code>。
            支持通过统一端口自动调度 {groupStats.total} 个邮箱账号下的 Antigravity、AI Studio Key 池、ChatGPT 与 Grok 渠道。
          </div>
        </div>
      ) : activeTab === "tasks" ? (
        <div className="cockpit-instances-card">
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>⏰ 唤醒任务计划</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            定时自动刷新配额并轮询账号健康状态。Google Antigravity 每 10 分钟校准窗口，Google AI Studio 日限额按太平洋时间（PT 00:00）自动归零。
          </div>
        </div>
      ) : displayedGroups.length === 0 ? (
        <div className="cockpit-empty">
          <IconUser style={{ width: 36, height: 36, opacity: 0.4 }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>未找到匹配的邮箱账号</span>
          <span style={{ fontSize: 13 }}>尝试调整筛选条件或点击“+”添加新账户</span>
          <button
            type="button"
            data-tip="添加新账号"
            className="cockpit-round-btn cockpit-round-btn--primary"
            style={{ marginTop: 8 }}
            onClick={() => setShowAddMenu(true)}
          >
            <IconPlus style={{ width: 14, height: 14 }} />
          </button>
        </div>
      ) : activeTab === "health" || viewMode === "list" ? (
        <CockpitHealthTable
          groups={displayedGroups}
          selectedIds={selectedIds}
          switchingId={switchingId}
          refreshingId={refreshingId}
          testingHealthIds={testingHealthIds}
          isTestingAll={isTestingAll}
          pausingId={pausingId}
          isBatchPausing={isBatchPausing}
          isCopiedKey={k => outcomeFor(k) === "copied"}
          formatEmail={formatDisplayEmail}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelectOne={toggleSelectOne}
          onSwitch={handleSwitchAccount}
          onRefresh={handleRefreshAccount}
          onRefreshGroup={handleRefreshGroup}
          onTogglePause={handleTogglePauseAccount}
          onPauseAllUnusable={handlePauseAllUnusable}
          onTestHealth={handleTestAccountHealth}
          onTestAllHealth={handleTestAllAccountsHealth}
          onEditAlias={handleEditAlias}
          onEditAiStudioKey={handleEditAiStudioKeyForGroup}
          onAddPlatform={(email, p) => void handleAddOAuthAccount(p, email)}
          onCopy={copy}
          onRemoveGroup={handleRemoveGroup}
          onRemovePlatform={handleRemovePlatform}
        />
      ) : (
        <div className="cockpit-grid cockpit-grid--merged">
          {displayedGroups.map(group => (
            <CockpitAccountCard
              key={group.emailKey}
              group={group}
              isSelected={selectedIds.has(group.emailKey)}
              switchingId={switchingId}
              refreshingId={refreshingId}
              testingHealthIds={testingHealthIds}
              pausingId={pausingId}
              copiedId={outcomeFor(group.emailKey) === "copied" ? group.emailKey : null}
              formatEmail={formatDisplayEmail}
              onToggleSelect={toggleSelectOne}
              onSwitch={handleSwitchAccount}
              onRefresh={handleRefreshAccount}
              onRefreshGroup={handleRefreshGroup}
              onTogglePause={handleTogglePauseAccount}
              onTestHealth={handleTestAccountHealth}
              onEditAlias={handleEditAlias}
              onEditAiStudioKey={handleEditAiStudioKeyForGroup}
              onAddPlatform={(email, p) => void handleAddOAuthAccount(p, email)}
              onCopy={copy}
              onRemoveGroup={handleRemoveGroup}
              onRemovePlatform={handleRemovePlatform}
              onShowInfo={setInfoModalGroup}
              onExport={handleExportGroup}
            />
          ))}
        </div>
      )}

      {showAddCodexModal && (
        <AddCodexAccountModal
          apiBase={apiBase}
          onClose={() => {
            setShowAddCodexModal(false);
            oauth.clearTargetEmail();
          }}
          onAdded={() => {
            setShowAddCodexModal(false);
            oauth.clearTargetEmail();
            void loadAccounts();
          }}
        />
      )}

      {infoModalGroup && (
        <div className="cockpit-modal-backdrop" onClick={() => setInfoModalGroup(null)}>
          <div className="cockpit-modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>邮箱聚合详情 · {infoModalGroup.email}</h3>
              <button
                type="button"
                data-tip="关闭详情"
                className="cockpit-icon-btn"
                onClick={() => setInfoModalGroup(null)}
              >
                ×
              </button>
            </div>
            <pre style={{ fontSize: 12, overflow: "auto", maxHeight: 380, background: "light-dark(#f1f5f9, #1a1b1e)", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(infoModalGroup, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
