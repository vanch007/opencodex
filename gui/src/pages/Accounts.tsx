import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnifiedAccountItem } from "../types/account";
import { confirmAction, requestTextValue } from "../action-dialogs";
import AddCodexAccountModal from "../components/AddCodexAccountModal";
import { useCopyFeedback } from "../components/use-copy-feedback";
import { CockpitAccountCard } from "../components/accounts/CockpitAccountCard";
import { CockpitHeader } from "../components/accounts/CockpitHeader";
import { CockpitToolbar } from "../components/accounts/CockpitToolbar";
import { CockpitHealthTable } from "../components/accounts/CockpitHealthTable";
import { IconPlus, IconRefresh, IconUser } from "../icons";

export default function Accounts({ apiBase }: { apiBase: string }) {
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<UnifiedAccountItem[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"quota" | "reset" | "email">("quota");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showSensitive, setShowSensitive] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"overview" | "instances" | "tasks" | "health">("overview");
  const [showAddCodexModal, setShowAddCodexModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [infoModalAccount, setInfoModalAccount] = useState<UnifiedAccountItem | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const { outcomeFor, copy } = useCopyFeedback<string>();

  // Fetch accounts across providers.
  // Two-phase load: phase 1 reads the cheap local lists (no quota probing) and renders them at once,
  // carrying over any quota already on screen; phase 2 probes quota per provider in parallel and
  // merges each provider's rows in as soon as it settles, so a slow probe never blocks the list.
  const loadAccounts = useCallback(async (refresh = false) => {
    const refreshParam = refresh ? "&refresh=1" : "";
    const mapOAuth = (p: string, data: { activeAccountId?: string | null; accounts?: Array<any> }): UnifiedAccountItem[] => {
      const isXai = p === "xai";
      return (data.accounts ?? []).map(acc => ({
        id: acc.id,
        provider: p,
        providerLabel: p === "google-antigravity" ? "Google Antigravity" : isXai ? "xAI Grok" : p,
        email: acc.email || (isXai ? (acc.alias ? `${acc.alias}@x.ai` : `grok-${acc.id.slice(0, 8)}@x.ai`) : ""),
        alias: acc.alias,
        active: acc.active === true || acc.id === data.activeAccountId,
        plan: acc.plan ?? (isXai ? "GROK" : "g1-pro-tier"),
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
      }));
    };
    const mapCodex = (data: { accounts?: Array<any> }): UnifiedAccountItem[] => (data.accounts ?? []).map(acc => ({
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
    }));
    const getJson = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await fetch(url);
        return res.ok ? await res.json() as T : null;
      } catch { return null; }
    };
    const provData = await getJson<{ providers?: string[] }>(`${apiBase}/api/oauth/providers`);
    const oauthProviders = provData?.providers ?? ["google-antigravity"];

    // Phase 1: cheap lists, rendered immediately.
    type OAuthData = { activeAccountId?: string | null; accounts?: Array<any> };
    const [plainLists, plainCodex] = await Promise.all([
      Promise.all(oauthProviders.map(p => getJson<OAuthData>(`${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(p)}`))),
      getJson<{ accounts?: Array<any> }>(`${apiBase}/api/codex-auth/accounts`),
    ]);
    const plain: UnifiedAccountItem[] = [];
    oauthProviders.forEach((p, i) => { const d = plainLists[i]; if (d) plain.push(...mapOAuth(p, d)); });
    if (plainCodex) plain.push(...mapCodex(plainCodex));
    setAccounts(prev => {
      const old = new Map(prev.map(a => [`${a.provider}:${a.id}`, a]));
      return plain.map(a => {
        const before = old.get(`${a.provider}:${a.id}`);
        if (!a.quota && before?.quota) return { ...a, quota: before.quota, updatedAt: before.updatedAt ?? a.updatedAt };
        return { ...a, quotaPending: a.quotaMode === "probe" ? !before?.quota : a.quotaPending };
      });
    });
    setLoading(false);

    // Phase 2: probe quota per provider in parallel; merge each result as it arrives.
    const merge = (provider: string, fresh: UnifiedAccountItem[]) => setAccounts(prev => {
      const byId = new Map(fresh.map(a => [a.id, a]));
      return prev.map(a => (a.provider === provider && byId.has(a.id) ? { ...byId.get(a.id)!, quotaPending: false } : a));
    });
    await Promise.all([
      ...oauthProviders.map(async p => {
        const d = await getJson<OAuthData>(`${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(p)}&quota=1${refreshParam}`);
        if (d) merge(p, mapOAuth(p, d));
        else setAccounts(prev => prev.map(a => (a.provider === p ? { ...a, quotaPending: false } : a)));
      }),
    ]);
  }, [apiBase]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

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

  const handleRemoveAccount = async (item: UnifiedAccountItem) => {
    const ok = await confirmAction({
      message: `确定要移除账号 ${item.alias ? `${item.alias} (${item.email})` : item.email} 吗？移除后需重新登录授权。`,
      confirmLabel: "确认移除",
      tone: "danger",
    });
    if (!ok) return;
    if (item.provider === "openai") {
      await fetch(`${apiBase}/api/codex-auth/accounts?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    } else {
      await fetch(
        `${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(item.provider)}&id=${encodeURIComponent(item.id)}`,
        { method: "DELETE" }
      );
    }
    await loadAccounts();
  };

  const handleAddOAuthAccount = async (provider: string) => {
    setShowAddMenu(false);
    if (provider === "openai") {
      setShowAddCodexModal(true);
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/oauth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, addAccount: true }),
      });
      const data = await res.json().catch(() => ({})) as { url?: string };
      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch { /* ignore */ }
  };

  const handleExportAccount = (acc: UnifiedAccountItem) => {
    const jsonStr = JSON.stringify(acc, null, 2);
    void copy(jsonStr, `export-${acc.id}`);
  };

  const handleExportAll = () => {
    const jsonStr = JSON.stringify(accounts, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opencodex-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenFolder = () => {
    window.alert("OpenCodex 配置文件及数据存储位于本地目录：~/.opencodex");
  };

  const handleOpenSettings = () => {
    window.location.hash = "#settings";
  };

  // Provider counts
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const acc of accounts) {
      counts[acc.provider] = (counts[acc.provider] ?? 0) + 1;
    }
    return counts;
  }, [accounts]);

  // Filtered and sorted accounts
  const displayedAccounts = useMemo(() => {
    return accounts
      .filter(acc => {
        if (selectedProvider !== "all" && acc.provider !== selectedProvider) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const emailMatch = acc.email.toLowerCase().includes(q);
          const aliasMatch = (acc.alias ?? "").toLowerCase().includes(q);
          const idMatch = acc.id.toLowerCase().includes(q);
          if (!emailMatch && !aliasMatch && !idMatch) return false;
        }
        if (statusFilter === "active" && !acc.active) return false;
        if (statusFilter === "paused" && !acc.paused) return false;
        if (statusFilter === "reauth" && acc.health?.status !== "reauth_required") return false;
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === "email") {
          diff = (a.email || a.id).localeCompare(b.email || b.id);
        } else if (sortBy === "reset") {
          const aReset = a.quota?.customWindows?.[0]?.resetAt ?? 0;
          const bReset = b.quota?.customWindows?.[0]?.resetAt ?? 0;
          diff = aReset - bReset;
        } else {
          // Default: quota. Active accounts always first, then remaining %
          if (a.active && !b.active) return -1;
          if (!a.active && b.active) return 1;
          const aPct = a.quota?.customWindows?.[0]?.percent ?? a.quota?.monthlyPercent ?? 0;
          const bPct = b.quota?.customWindows?.[0]?.percent ?? b.quota?.monthlyPercent ?? 0;
          diff = bPct - aPct;
        }
        return sortOrder === "asc" ? -diff : diff;
      });
  }, [accounts, selectedProvider, searchQuery, statusFilter, sortBy, sortOrder]);

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedAccounts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedAccounts.map(a => a.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const formatDisplayEmail = (email: string) => {
    if (!email) return "Unknown";
    if (showSensitive) return email;
    const parts = email.split("@");
    if (parts.length !== 2) return email;
    const name = parts[0];
    const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : `${name}*`;
    return `${maskedName}@${parts[1]}`;
  };

  return (
    <div className="cockpit-accounts-page">
      {/* ── Cockpit Header ── */}
      <CockpitHeader
        totalCount={accounts.length}
        antigravityCount={providerCounts["google-antigravity"] ?? 0}
        openaiCount={providerCounts["openai"] ?? 0}
        grokCount={providerCounts["xai"] ?? 0}
        selectedProvider={selectedProvider}
        activeTab={activeTab}
        onSelectProvider={setSelectedProvider}
        onSelectTab={setActiveTab}
      />

      {/* ── Cockpit Toolbar ── */}
      <div style={{ position: "relative" }} ref={addMenuRef}>
        <CockpitToolbar
          searchQuery={searchQuery}
          viewMode={viewMode}
          statusFilter={statusFilter}
          sortBy={sortBy}
          sortOrder={sortOrder}
          showSensitive={showSensitive}
          refreshingAll={refreshingAll}
          totalDisplayed={displayedAccounts.length}
          selectedCount={selectedIds.size}
          isAllSelected={displayedAccounts.length > 0 && selectedIds.size === displayedAccounts.length}
          onSearchChange={setSearchQuery}
          onViewModeChange={setViewMode}
          onStatusFilterChange={setStatusFilter}
          onSortByChange={setSortBy}
          onToggleSortOrder={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          onToggleSensitive={() => setShowSensitive(!showSensitive)}
          onRefreshAll={() => void handleRefreshAll()}
          onAddAccount={() => setShowAddMenu(!showAddMenu)}
          onToggleSelectAll={toggleSelectAll}
          onExportAll={handleExportAll}
          onOpenFolder={handleOpenFolder}
          onOpenSettings={handleOpenSettings}
        />

        {showAddMenu && (
          <div className="cockpit-add-menu">
            <button
              type="button"
              className="cockpit-dropdown-item"
              onClick={() => void handleAddOAuthAccount("google-antigravity")}
            >
              <span>添加 Google Antigravity</span>
            </button>
            <button
              type="button"
              className="cockpit-dropdown-item"
              onClick={() => void handleAddOAuthAccount("openai")}
            >
              <span>添加 OpenAI / Codex</span>
            </button>
            <button
              type="button"
              className="cockpit-dropdown-item"
              onClick={() => void handleAddOAuthAccount("xai")}
            >
              <span>添加 xAI Grok</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Main Content Views ── */}
      {loading ? (
        <div className="cockpit-empty">
          <IconRefresh className="spin" style={{ width: 28, height: 28 }} />
          <span>正在加载账号配额数据...</span>
        </div>
      ) : activeTab === "instances" ? (
        <div className="cockpit-instances-card">
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🗂 多开实例已就绪</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            当前 OpenCodex 本地代理实例运行于 <code>http://localhost:10100</code>。
            支持通过统一端口自动分配与轮换 Antigravity 15 个授权账号与 Codex 账号，无需手动启动多个端口实例。
          </div>
        </div>
      ) : activeTab === "tasks" ? (
        <div className="cockpit-instances-card">
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>⏰ 唤醒任务计划</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            定时自动刷新配额并轮询账号健康状态。当前计划：每 10 分钟自动校准一次 Google Antigravity 配额窗口。
          </div>
        </div>
      ) : displayedAccounts.length === 0 ? (
        <div className="cockpit-empty">
          <IconUser style={{ width: 36, height: 36, opacity: 0.4 }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>未找到匹配的账号</span>
          <span style={{ fontSize: 13 }}>尝试切换提供方标签或点击“+”授权新账户</span>
          <button
            type="button"
            className="cockpit-round-btn cockpit-round-btn--primary"
            style={{ marginTop: 8 }}
            onClick={() => setShowAddMenu(true)}
          >
            <IconPlus style={{ width: 14, height: 14 }} />
          </button>
        </div>
      ) : activeTab === "health" || viewMode === "list" ? (
        <CockpitHealthTable
          accounts={displayedAccounts}
          selectedIds={selectedIds}
          switchingId={switchingId}
          refreshingId={refreshingId}
          copiedId={outcomeFor("account-table")}
          formatEmail={formatDisplayEmail}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelectOne={toggleSelectOne}
          onSwitch={handleSwitchAccount}
          onRefresh={handleRefreshAccount}
          onEditAlias={handleEditAlias}
          onCopy={copy}
          onRemove={handleRemoveAccount}
        />
      ) : (
        /* Cockpit Grid Cards View */
        <div className="cockpit-grid">
          {displayedAccounts.map(acc => (
            <CockpitAccountCard
              key={`${acc.provider}:${acc.id}`}
              account={acc}
              isSelected={selectedIds.has(acc.id)}
              isSwitching={switchingId === acc.id}
              isRefreshing={refreshingId === acc.id}
              copiedId={outcomeFor(acc.id)}
              formatEmail={formatDisplayEmail}
              onToggleSelect={toggleSelectOne}
              onSwitch={handleSwitchAccount}
              onRefresh={handleRefreshAccount}
              onEditAlias={handleEditAlias}
              onCopy={copy}
              onRemove={handleRemoveAccount}
              onShowInfo={setInfoModalAccount}
              onExport={handleExportAccount}
            />
          ))}
        </div>
      )}

      {/* ── Add Codex Modal ── */}
      {showAddCodexModal && (
        <AddCodexAccountModal
          apiBase={apiBase}
          onClose={() => setShowAddCodexModal(false)}
          onAdded={() => {
            setShowAddCodexModal(false);
            void loadAccounts();
          }}
        />
      )}

      {/* ── Account Info Modal ── */}
      {infoModalAccount && (
        <div
          className="cockpit-modal-backdrop"
          onClick={() => setInfoModalAccount(null)}
        >
          <div
            className="cockpit-modal-card"
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>账号详情</h3>
              <button
                type="button"
                className="cockpit-icon-btn"
                onClick={() => setInfoModalAccount(null)}
              >
                ×
              </button>
            </div>
            <pre style={{ fontSize: 12, overflow: "auto", maxHeight: 360, background: "light-dark(#f1f5f9, #1a1b1e)", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(infoModalAccount, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
