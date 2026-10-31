import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmAction, requestTextValue } from "../action-dialogs";
import { formatAntigravityReset, AntigravityQuotaCard } from "../components/provider-workspace/AntigravityQuotaCard";
import AddCodexAccountModal from "../components/AddCodexAccountModal";
import {
  IconCheck,
  IconCopy,
  IconEyeOff,
  IconGrid,
  IconList,
  IconPencil,
  IconPlus,
  IconPower,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUser,
} from "../icons";
import { useCopyFeedback } from "../components/use-copy-feedback";
import type { AccountQuota } from "../codex-quota-utils";

export interface UnifiedAccountItem {
  id: string;
  provider: string; // "google-antigravity" | "openai" | ...
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
}

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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showSensitive, setShowSensitive] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"overview" | "health">("overview");
  const [showAddCodexModal, setShowAddCodexModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const { outcomeFor, copy } = useCopyFeedback<string>();

  // Close add menu on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Fetch accounts across providers
  const loadAccounts = useCallback(async (refresh = false) => {
    try {
      const authHeader = {};
      const refreshParam = refresh ? "&refresh=1" : "";

      // 1. Fetch public OAuth providers
      const provRes = await fetch(`${apiBase}/api/oauth/providers`, { headers: authHeader }).catch(() => null);
      const provData = provRes ? await provRes.json().catch(() => ({})) as { providers?: string[] } : {};
      const oauthProviders: string[] = provData.providers ?? ["google-antigravity"];

      const results: UnifiedAccountItem[] = [];

      // 2. Query each OAuth provider accounts
      for (const p of oauthProviders) {
        try {
          const res = await fetch(`${apiBase}/api/oauth/accounts?provider=${encodeURIComponent(p)}&quota=1${refreshParam}`);
          if (!res.ok) continue;
          const data = await res.json() as { activeAccountId?: string | null; accounts?: Array<any> };
          const activeId = data.activeAccountId;
          const list = data.accounts ?? [];
          for (const acc of list) {
            results.push({
              id: acc.id,
              provider: p,
              providerLabel: p === "google-antigravity" ? "Google Antigravity" : p,
              email: acc.email ?? "",
              alias: acc.alias,
              active: acc.active === true || acc.id === activeId,
              plan: acc.plan ?? "g1-pro-tier",
              quota: acc.quota ?? null,
              quotaMode: acc.quotaMode,
              quotaUnavailable: acc.quotaUnavailable,
              quotaPending: acc.quotaPending,
              health: acc.health,
              paused: acc.paused,
              expiresAt: acc.expiresAt,
              updatedAt: acc.quota?.updatedAt ?? acc.updatedAt,
            });
          }
        } catch { /* ignore individual provider fail */ }
      }

      // 3. Query OpenAI / Codex accounts
      try {
        const codexRes = await fetch(`${apiBase}/api/codex-auth/accounts`);
        if (codexRes.ok) {
          const codexData = await codexRes.json() as { accounts?: Array<any> };
          for (const acc of codexData.accounts ?? []) {
            results.push({
              id: acc.id,
              provider: "openai",
              providerLabel: "OpenAI / Codex",
              email: acc.email ?? "",
              alias: acc.logLabel || acc.alias,
              active: !acc.paused && acc.isMain,
              plan: acc.plan ?? "free",
              quota: acc.quota ?? null,
              health: acc.health,
              paused: acc.paused,
              isMain: acc.isMain,
              updatedAt: acc.quota?.updatedAt,
            });
          }
        }
      } catch { /* ignore codex fail */ }

      setAccounts(results);
    } finally {
      setLoading(false);
    }
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
          body: JSON.stringify({ provider: item.provider, id: item.id }),
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
        body: JSON.stringify({ provider: item.provider, id: item.id, alias: newAlias.trim() }),
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
      await fetch(`${apiBase}/api/oauth/accounts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: item.provider, id: item.id }),
      });
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

  // Provider options
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const acc of accounts) {
      counts[acc.provider] = (counts[acc.provider] ?? 0) + 1;
    }
    return counts;
  }, [accounts]);

  // Filtered and sorted accounts
  const displayedAccounts = useMemo(() => {
    return accounts.filter(acc => {
      // 1. Provider filter
      if (selectedProvider !== "all" && acc.provider !== selectedProvider) return false;
      // 2. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const emailMatch = acc.email.toLowerCase().includes(q);
        const aliasMatch = (acc.alias ?? "").toLowerCase().includes(q);
        const idMatch = acc.id.toLowerCase().includes(q);
        if (!emailMatch && !aliasMatch && !idMatch) return false;
      }
      // 3. Status filter
      if (statusFilter === "active" && !acc.active) return false;
      if (statusFilter === "paused" && !acc.paused) return false;
      if (statusFilter === "reauth" && acc.health?.status !== "reauth_required") return false;
      return true;
    }).sort((a, b) => {
      if (sortBy === "email") {
        return (a.email || a.id).localeCompare(b.email || b.id);
      }
      if (sortBy === "reset") {
        const aReset = a.quota?.customWindows?.[0]?.resetAt ?? 0;
        const bReset = b.quota?.customWindows?.[0]?.resetAt ?? 0;
        return aReset - bReset;
      }
      // Quota: sort by active first, then remaining %
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return (b.quota?.customWindows?.[0]?.percent ?? 0) - (a.quota?.customWindows?.[0]?.percent ?? 0);
    });
  }, [accounts, selectedProvider, searchQuery, statusFilter, sortBy]);

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
      {/* ── Top Bar ── */}
      <div className="cockpit-top-bar">
        <div className="cockpit-title-group">
          <h1 className="cockpit-page-title">
            <IconUser style={{ width: 22, height: 22 }} />
            账号
          </h1>
          <span className="cockpit-info-badge" title="集中管理 Google Antigravity、OpenAI 与各提供商账号配额">?</span>
          <span className="cockpit-version-tag">
            <span className="cockpit-status-dot" />
            OpenCodex 运行正常
          </span>
        </div>

        {/* Top Provider & Mode Tabs */}
        <div className="cockpit-nav-row">
          <div className="cockpit-provider-tabs">
            <button
              type="button"
              className={`cockpit-provider-tab${selectedProvider === "all" ? " active" : ""}`}
              onClick={() => setSelectedProvider("all")}
            >
              全部提供方
              <span className="cockpit-provider-tab-badge">{accounts.length}</span>
            </button>
            <button
              type="button"
              className={`cockpit-provider-tab${selectedProvider === "google-antigravity" ? " active" : ""}`}
              onClick={() => setSelectedProvider("google-antigravity")}
            >
              Google Antigravity
              <span className="cockpit-provider-tab-badge">{providerCounts["google-antigravity"] ?? 0}</span>
            </button>
            <button
              type="button"
              className={`cockpit-provider-tab${selectedProvider === "openai" ? " active" : ""}`}
              onClick={() => setSelectedProvider("openai")}
            >
              OpenAI / Codex
              <span className="cockpit-provider-tab-badge">{providerCounts["openai"] ?? 0}</span>
            </button>
          </div>

          <div className="cockpit-provider-tabs">
            <button
              type="button"
              className={`cockpit-provider-tab${activeTab === "overview" ? " active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              账号总览
            </button>
            <button
              type="button"
              className={`cockpit-provider-tab${activeTab === "health" ? " active" : ""}`}
              onClick={() => setActiveTab("health")}
            >
              账户检测
            </button>
          </div>
        </div>
      </div>

      {/* ── Filter Toolbar ── */}
      <div className="cockpit-toolbar">
        <div className="cockpit-toolbar-left">
          {/* Search box */}
          <div className="cockpit-search-wrap">
            <IconSearch style={{ width: 14, height: 14, color: "var(--muted)" }} />
            <input
              type="text"
              className="cockpit-search-input"
              placeholder="搜索账号邮箱、别名..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}
                onClick={() => setSearchQuery("")}
              >
                ×
              </button>
            )}
          </div>

          {/* View mode toggle */}
          <div className="cockpit-view-toggle">
            <button
              type="button"
              className={`cockpit-view-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="网格视图"
            >
              <IconGrid style={{ width: 15, height: 15 }} />
            </button>
            <button
              type="button"
              className={`cockpit-view-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => setViewMode("list")}
              title="列表视图"
            >
              <IconList style={{ width: 15, height: 15 }} />
            </button>
          </div>

          {/* Status filter */}
          <select
            className="cockpit-filter-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">全部状态 ({accounts.length})</option>
            <option value="active">当前使用中</option>
            <option value="reauth">需重新登录</option>
            <option value="paused">已暂停</option>
          </select>

          {/* Sort selector */}
          <select
            className="cockpit-filter-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="quota">按综合配额排序</option>
            <option value="reset">按最近重置时间</option>
            <option value="email">按账号邮箱名称</option>
          </select>
        </div>

        {/* Toolbar Action buttons */}
        <div className="cockpit-toolbar-right" style={{ position: "relative" }} ref={addMenuRef}>
          {/* Add account button */}
          <button
            type="button"
            className="cockpit-btn cockpit-btn-primary"
            onClick={() => setShowAddMenu(!showAddMenu)}
          >
            <IconPlus style={{ width: 14, height: 14 }} />
            添加账号
          </button>

          {showAddMenu && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                zIndex: 100,
                background: "light-dark(#ffffff, #202227)",
                border: "1px solid light-dark(#e2e8f0, #33363f)",
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                padding: "6px",
                minWidth: 190,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <button
                type="button"
                className="cockpit-btn cockpit-btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start", padding: "8px 12px" }}
                onClick={() => void handleAddOAuthAccount("google-antigravity")}
              >
                添加 Google Antigravity
              </button>
              <button
                type="button"
                className="cockpit-btn cockpit-btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start", padding: "8px 12px" }}
                onClick={() => void handleAddOAuthAccount("openai")}
              >
                添加 OpenAI / Codex
              </button>
            </div>
          )}

          {/* Refresh all */}
          <button
            type="button"
            className="cockpit-btn cockpit-btn-ghost"
            onClick={() => void handleRefreshAll()}
            disabled={refreshingAll}
            title="刷新全部账号配额"
          >
            <IconRefresh style={{ width: 14, height: 14 }} className={refreshingAll ? "spin" : ""} />
            刷新配额
          </button>

          {/* Mask toggle */}
          <button
            type="button"
            className="cockpit-btn cockpit-btn-ghost"
            onClick={() => setShowSensitive(!showSensitive)}
            title={showSensitive ? "点击脱敏邮箱" : "点击显示完整邮箱"}
          >
            <IconEyeOff style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>

      {/* ── Sub Toolbar (Select All & Total Counts) ── */}
      <div className="cockpit-sub-toolbar">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            className="cockpit-checkbox"
            checked={displayedAccounts.length > 0 && selectedIds.size === displayedAccounts.length}
            onChange={toggleSelectAll}
          />
          全选 ({displayedAccounts.length})
        </label>
        <div>
          <span>已就绪 {displayedAccounts.length} 个账号</span>
          {selectedIds.size > 0 && <span style={{ marginLeft: 8, color: "#3b82f6" }}>· 已选中 {selectedIds.size} 个</span>}
        </div>
      </div>

      {/* ── Content View (Grid or List or Health Table) ── */}
      {loading ? (
        <div className="cockpit-empty">
          <IconRefresh className="spin" style={{ width: 28, height: 28 }} />
          <span>正在加载账号配额数据...</span>
        </div>
      ) : displayedAccounts.length === 0 ? (
        <div className="cockpit-empty">
          <IconUser style={{ width: 36, height: 36, opacity: 0.4 }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>未找到匹配的账号</span>
          <span style={{ fontSize: 13 }}>尝试切换提供方标签或点击“添加账号”授权新账户</span>
          <button
            type="button"
            className="cockpit-btn cockpit-btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => setShowAddMenu(true)}
          >
            <IconPlus style={{ width: 14, height: 14 }} />
            添加账号
          </button>
        </div>
      ) : activeTab === "health" ? (
        /* ── Health Detection Table ── */
        <div className="cockpit-table-wrap">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    className="cockpit-checkbox"
                    checked={selectedIds.size === displayedAccounts.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>账号邮箱 / 别名</th>
                <th>提供商</th>
                <th>当前计划</th>
                <th>健康检测状态</th>
                <th>活跃状态</th>
                <th>更新时间</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayedAccounts.map(acc => (
                <tr key={`${acc.provider}:${acc.id}`}>
                  <td>
                    <input
                      type="checkbox"
                      className="cockpit-checkbox"
                      checked={selectedIds.has(acc.id)}
                      onChange={() => toggleSelectOne(acc.id)}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{formatDisplayEmail(acc.email)}</div>
                    {acc.alias && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{acc.alias}</div>}
                  </td>
                  <td>
                    <span className="badge badge-muted">{acc.providerLabel}</span>
                  </td>
                  <td>
                    <span className="cockpit-badge-plan">{acc.plan?.toUpperCase()}</span>
                  </td>
                  <td>
                    <span className={`badge ${acc.health?.status === "healthy" ? "badge-green" : "badge-amber"}`}>
                      {acc.health?.status ?? "healthy"}
                    </span>
                  </td>
                  <td>
                    {acc.active ? (
                      <span className="cockpit-badge-active">当前使用中</span>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>备用就绪</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                    {acc.updatedAt ? new Date(acc.updatedAt).toLocaleTimeString() : "-"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="cockpit-card-actions" style={{ justifyContent: "flex-end" }}>
                      {!acc.active && (
                        <button
                          type="button"
                          className="cockpit-icon-btn cockpit-icon-btn--primary"
                          title="设为当前账号"
                          onClick={() => void handleSwitchAccount(acc)}
                        >
                          <IconPower style={{ width: 14, height: 14 }} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="cockpit-icon-btn"
                        title="刷新配额"
                        onClick={() => void handleRefreshAccount(acc)}
                      >
                        <IconRefresh style={{ width: 14, height: 14 }} />
                      </button>
                      <button
                        type="button"
                        className="cockpit-icon-btn cockpit-icon-btn--danger"
                        title="移除账号"
                        onClick={() => void handleRemoveAccount(acc)}
                      >
                        <IconTrash style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Cockpit Grid Cards ── */
        <div className="cockpit-grid">
          {displayedAccounts.map(acc => {
            const isAntigravity = acc.provider === "google-antigravity";
            return (
              <div
                key={`${acc.provider}:${acc.id}`}
                className={`cockpit-card${acc.active ? " cockpit-card--active" : ""}`}
              >
                {/* Card Header */}
                <div className="cockpit-card-head">
                  <div className="cockpit-card-title-group">
                    <input
                      type="checkbox"
                      className="cockpit-checkbox"
                      checked={selectedIds.has(acc.id)}
                      onChange={() => toggleSelectOne(acc.id)}
                    />
                    <span className="cockpit-card-email" title={acc.email}>
                      {formatDisplayEmail(acc.email)}
                    </span>
                  </div>
                  <div className="cockpit-card-badges">
                    {acc.active && <span className="cockpit-badge-active">当前</span>}
                    {acc.plan && (
                      <span className={`cockpit-badge-plan${acc.plan === "free" ? " cockpit-badge-plan--free" : acc.plan === "plus" ? " cockpit-badge-plan--plus" : ""}`}>
                        {acc.plan === "g1-pro-tier" ? "PRO" : acc.plan.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Body */}
                <div className="cockpit-card-body">
                  {isAntigravity ? (
                    <AntigravityQuotaCard quota={acc.quota} pending={acc.quotaPending} />
                  ) : (
                    /* OpenAI / Codex Card Body */
                    <div className="cockpit-codex-body">
                      <div className="cockpit-codex-meta">
                        <span>Team Name: 个人账户 · 用户 ID: {acc.id.slice(0, 10)}...</span>
                        {acc.alias && <span>别名: {acc.alias}</span>}
                      </div>

                      {/* Quota Row */}
                      <div className="cockpit-codex-quota-row">
                        <div className="cockpit-codex-quota-head">
                          <span>5 Week</span>
                          <span className="cockpit-codex-quota-pct">
                            {Math.max(0, Math.min(100, Math.round(100 - (acc.quota?.monthlyPercent ?? 0))))}%
                          </span>
                        </div>
                        <div className="ag-quota-bar-track">
                          <div
                            className="ag-quota-bar-fill ag-quota-bar-fill--healthy"
                            style={{
                              width: `${Math.max(0, Math.min(100, Math.round(100 - (acc.quota?.monthlyPercent ?? 0))))}%`,
                            }}
                          />
                        </div>
                        {acc.quota?.monthlyResetAt && (
                          <div className="ag-quota-reset">
                            {formatAntigravityReset(acc.quota.monthlyResetAt)}
                          </div>
                        )}
                      </div>

                      {/* Expiry / Status row */}
                      <div className={`cockpit-codex-expiry${acc.paused ? "" : " cockpit-codex-expiry--ok"}`}>
                        <span>有效期: {acc.paused ? "已暂停" : "正常有效"}</span>
                        <span>{acc.updatedAt ? new Date(acc.updatedAt).toLocaleDateString() : "近期已更新"}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div className="cockpit-card-foot">
                  <span className="cockpit-card-date">
                    {acc.updatedAt ? new Date(acc.updatedAt).toLocaleDateString() : "已激活"}
                  </span>

                  <div className="cockpit-card-actions">
                    {!acc.active && (
                      <button
                        type="button"
                        className="cockpit-icon-btn cockpit-icon-btn--primary"
                        title="设为当前活跃账号"
                        disabled={switchingId === acc.id}
                        onClick={() => void handleSwitchAccount(acc)}
                      >
                        <IconPower style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title="刷新该账号配额"
                      disabled={refreshingId === acc.id}
                      onClick={() => void handleRefreshAccount(acc)}
                    >
                      <IconRefresh style={{ width: 14, height: 14 }} className={refreshingId === acc.id ? "spin" : ""} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title="编辑别名 / 备注"
                      onClick={() => void handleEditAlias(acc)}
                    >
                      <IconPencil style={{ width: 14, height: 14 }} />
                    </button>
                    {(() => {
                      const isCopied = outcomeFor(acc.id) === "copied";
                      return (
                        <button
                          type="button"
                          className="cockpit-icon-btn"
                          title={isCopied ? "已复制" : "复制账号邮箱"}
                          onClick={() => void copy(acc.email || acc.id, acc.id)}
                        >
                          {isCopied ? <IconCheck style={{ width: 14, height: 14, color: "#10b981" }} /> : <IconCopy style={{ width: 14, height: 14 }} />}
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      className="cockpit-icon-btn cockpit-icon-btn--danger"
                      title="移除账号"
                      onClick={() => void handleRemoveAccount(acc)}
                    >
                      <IconTrash style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Cockpit List View ── */
        <div className="cockpit-table-wrap">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    className="cockpit-checkbox"
                    checked={selectedIds.size === displayedAccounts.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>账号邮箱 / 备注</th>
                <th>提供商</th>
                <th>当前计划</th>
                <th>配额详情</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>快捷操作</th>
              </tr>
            </thead>
            <tbody>
              {displayedAccounts.map(acc => (
                <tr key={`${acc.provider}:${acc.id}`}>
                  <td>
                    <input
                      type="checkbox"
                      className="cockpit-checkbox"
                      checked={selectedIds.has(acc.id)}
                      onChange={() => toggleSelectOne(acc.id)}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{formatDisplayEmail(acc.email)}</div>
                    {acc.alias && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{acc.alias}</div>}
                  </td>
                  <td>
                    <span className="badge badge-muted">{acc.providerLabel}</span>
                  </td>
                  <td>
                    <span className="cockpit-badge-plan">{acc.plan?.toUpperCase()}</span>
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    {acc.provider === "google-antigravity" ? (
                      <AntigravityQuotaCard quota={acc.quota} pending={acc.quotaPending} />
                    ) : (
                      <div style={{ fontSize: 12 }}>
                        剩余 {Math.max(0, Math.min(100, Math.round(100 - (acc.quota?.monthlyPercent ?? 0))))}%
                      </div>
                    )}
                  </td>
                  <td>
                    {acc.active ? (
                      <span className="cockpit-badge-active">当前使用中</span>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>就绪</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="cockpit-card-actions" style={{ justifyContent: "flex-end" }}>
                      {!acc.active && (
                        <button
                          type="button"
                          className="cockpit-icon-btn cockpit-icon-btn--primary"
                          title="设为当前账号"
                          onClick={() => void handleSwitchAccount(acc)}
                        >
                          <IconPower style={{ width: 14, height: 14 }} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="cockpit-icon-btn"
                        title="刷新配额"
                        onClick={() => void handleRefreshAccount(acc)}
                      >
                        <IconRefresh style={{ width: 14, height: 14 }} />
                      </button>
                      <button
                        type="button"
                        className="cockpit-icon-btn"
                        title="编辑别名 / 备注"
                        onClick={() => void handleEditAlias(acc)}
                      >
                        <IconPencil style={{ width: 14, height: 14 }} />
                      </button>
                      <button
                        type="button"
                        className="cockpit-icon-btn cockpit-icon-btn--danger"
                        title="移除账号"
                        onClick={() => void handleRemoveAccount(acc)}
                      >
                        <IconTrash style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Codex Modal */}
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
    </div>
  );
}
