import React from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconGrid,
  IconList,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconUpload,
} from "../../icons";

interface CockpitToolbarProps {
  searchQuery: string;
  viewMode: "grid" | "list";
  statusFilter: string;
  planFilter: string;
  sortBy: "quota" | "reset" | "email";
  sortOrder: "asc" | "desc";
  showSensitive: boolean;
  refreshingAll: boolean;
  sensitiveBusy?: boolean;
  totalDisplayed: number;
  selectedCount: number;
  isAllSelected: boolean;
  planCounts?: {
    total: number;
    pro: number;
    free: number;
    ultra: number;
    plus: number;
    argon: number;
    flash: number;
  };
  onSearchChange: (q: string) => void;
  onViewModeChange: (mode: "grid" | "list") => void;
  onStatusFilterChange: (status: string) => void;
  onPlanFilterChange: (plan: string) => void;
  onSortByChange: (sort: "quota" | "reset" | "email") => void;
  onToggleSortOrder: () => void;
  onToggleSensitive: () => void;
  onRefreshAll: () => void;
  onAddAccount: () => void;
  onToggleSelectAll: () => void;
  onExportAll: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
}

export const CockpitToolbar: React.FC<CockpitToolbarProps> = ({
  searchQuery,
  viewMode,
  statusFilter,
  planFilter,
  sortBy,
  sortOrder,
  showSensitive,
  refreshingAll,
  sensitiveBusy = false,
  totalDisplayed,
  selectedCount,
  isAllSelected,
  planCounts,
  onSearchChange,
  onViewModeChange,
  onStatusFilterChange,
  onPlanFilterChange,
  onSortByChange,
  onToggleSortOrder,
  onToggleSensitive,
  onRefreshAll,
  onAddAccount,
  onToggleSelectAll,
  onExportAll,
  onOpenFolder,
  onOpenSettings,
}) => {
  return (
    <>
      <div className="cockpit-toolbar">
        {/* ── Left Controls ── */}
        <div className="cockpit-toolbar-left">
          {/* Search box */}
          <div className="cockpit-search-wrap">
            <IconSearch style={{ width: 14, height: 14, color: "var(--muted)" }} />
            <input
              type="text"
              className="cockpit-search-input"
              placeholder="搜索账号..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="btn-ghost"
                data-tip="清空搜索"
                style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}
                onClick={() => onSearchChange("")}
              >
                ×
              </button>
            )}
          </div>

          {/* View mode toggle */}
          <div className="cockpit-view-toggle">
            <button
              type="button"
              className={`cockpit-view-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => onViewModeChange("list")}
              data-tip="列表视图"
            >
              <IconList style={{ width: 15, height: 15 }} />
            </button>
            <button
              type="button"
              className={`cockpit-view-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => onViewModeChange("grid")}
              data-tip="网格视图"
            >
              <IconGrid style={{ width: 15, height: 15 }} />
            </button>
          </div>

          {/* Status filter dropdown */}
          <select
            className="cockpit-filter-select"
            value={statusFilter}
            onChange={e => onStatusFilterChange(e.target.value)}
            title="按账号活跃、健康状态或渠道开通情况筛选"
          >
            <option value="all">状态: 全部 ({totalDisplayed})</option>
            <option value="active">当前使用中</option>
            <option value="ready">备用就绪</option>
            <option value="unusable">异常/失效 (需停用)</option>
            <option value="paused">已停用/已暂停</option>
            <option value="reauth">需重新登录</option>
            <option disabled value="__ch_sep__" style={{ color: "var(--muted)" }}>──────────</option>
            <option value="has-aistudio">已关联 AI Studio Key</option>
            <option value="no-aistudio">未关联 AI Studio Key</option>
            <option value="has-chatgpt">已开通 ChatGPT</option>
            <option value="has-grok">已开通 Grok</option>
          </select>

          {/* Membership Tier & Model Tier filter dropdown */}
          <select
            className="cockpit-filter-select"
            value={planFilter}
            onChange={e => onPlanFilterChange(e.target.value)}
            title="按会员等级 (Free/Pro/Ultra) 或模型能力筛选"
          >
            <option value="all">等级: 全部 {planCounts ? `(${planCounts.total})` : ""}</option>
            <option value="pro">Pro 会员 {planCounts ? `(${planCounts.pro})` : ""}</option>
            <option value="free">Free 免费 {planCounts ? `(${planCounts.free})` : ""}</option>
            <option value="ultra">Ultra 会员 {planCounts ? `(${planCounts.ultra})` : ""}</option>
            {planCounts && planCounts.plus > 0 && (
              <option value="plus">Plus 会员 ({planCounts.plus})</option>
            )}
            <option disabled value="__sep__" style={{ color: "var(--muted)" }}>──────────</option>
            <option value="argon">🌟 Argon+C5.5 (高阶) {planCounts ? `(${planCounts.argon})` : ""}</option>
            <option value="flash">⚡ Flash+C4.6 (基础) {planCounts ? `(${planCounts.flash})` : ""}</option>
          </select>

          {/* Sort selector */}
          <select
            className="cockpit-filter-select"
            value={sortBy}
            onChange={e => onSortByChange(e.target.value as "quota" | "reset" | "email")}
          >
            <option value="quota">按综合配额</option>
            <option value="reset">按最近重置</option>
            <option value="email">按创建时间</option>
          </select>

          {/* Sort order toggle button */}
          <button
            type="button"
            className="cockpit-icon-btn"
            style={{ width: 32, height: 32 }}
            onClick={onToggleSortOrder}
            data-tip={sortOrder === "desc" ? "当前：降序，点击切换升序" : "当前：升序，点击切换降序"}
          >
            {sortOrder === "desc" ? (
              <IconArrowDown style={{ width: 14, height: 14 }} />
            ) : (
              <IconArrowUp style={{ width: 14, height: 14 }} />
            )}
          </button>
        </div>

        {/* ── Right Action Buttons ── */}
        <div className="cockpit-toolbar-right">
          {/* Add account button */}
          <button
            type="button"
            className="cockpit-round-btn cockpit-round-btn--primary"
            onClick={onAddAccount}
            data-tip="添加新账号"
          >
            <IconPlus style={{ width: 15, height: 15 }} />
          </button>

          {/* Refresh all */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onRefreshAll}
            disabled={refreshingAll}
            data-tip="刷新全部账号配额"
          >
            <IconRefresh
              style={{ width: 15, height: 15 }}
              className={refreshingAll ? "spin" : ""}
            />
          </button>

          {/* Full email / masked email toggle */}
          <button
            type="button"
            className={`cockpit-round-btn${showSensitive ? " active" : ""}`}
            onClick={onToggleSensitive}
            disabled={sensitiveBusy}
            aria-pressed={showSensitive}
            data-tip={showSensitive ? "当前显示完整邮箱，点击隐藏/脱敏" : "当前已脱敏，点击显示完整邮箱"}
          >
            {showSensitive
              ? <IconEye style={{ width: 15, height: 15 }} />
              : <IconEyeOff style={{ width: 15, height: 15 }} />}
          </button>

          {/* Export */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onExportAll}
            data-tip="导出全部账号配置"
          >
            <IconUpload style={{ width: 15, height: 15 }} />
          </button>

          {/* Folder */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onOpenFolder}
            data-tip="打开配置与数据目录"
          >
            <IconFolder style={{ width: 15, height: 15 }} />
          </button>

          {/* Settings */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onOpenSettings}
            data-tip="账号与配额策略设置"
          >
            <IconSettings style={{ width: 15, height: 15 }} />
          </button>
        </div>
      </div>

      {/* ── Sub Toolbar (Select All & Total Counts) ── */}
      <div className="cockpit-sub-toolbar">
        <label className="cockpit-checkbox-label">
          <input
            type="checkbox"
            className="cockpit-checkbox"
            checked={isAllSelected}
            onChange={onToggleSelectAll}
          />
          <span>全选</span>
        </label>
        <div>
          <span>已就绪 {totalDisplayed} 个邮箱账号</span>
          {selectedCount > 0 && (
            <span style={{ marginLeft: 8, color: "#3b82f6", fontWeight: 600 }}>
              · 已选中 {selectedCount} 个
            </span>
          )}
        </div>
      </div>
    </>
  );
};
