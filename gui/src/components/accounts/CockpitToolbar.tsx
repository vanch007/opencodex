import React from "react";
import {
  IconArrowDown,
  IconArrowUp,
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
  sortBy: "quota" | "reset" | "email";
  sortOrder: "asc" | "desc";
  showSensitive: boolean;
  refreshingAll: boolean;
  totalDisplayed: number;
  selectedCount: number;
  isAllSelected: boolean;
  onSearchChange: (q: string) => void;
  onViewModeChange: (mode: "grid" | "list") => void;
  onStatusFilterChange: (status: string) => void;
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
  sortBy,
  sortOrder,
  showSensitive,
  refreshingAll,
  totalDisplayed,
  selectedCount,
  isAllSelected,
  onSearchChange,
  onViewModeChange,
  onStatusFilterChange,
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
              title="列表视图"
            >
              <IconList style={{ width: 15, height: 15 }} />
            </button>
            <button
              type="button"
              className={`cockpit-view-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => onViewModeChange("grid")}
              title="网格视图"
            >
              <IconGrid style={{ width: 15, height: 15 }} />
            </button>
          </div>

          {/* Status filter dropdown */}
          <select
            className="cockpit-filter-select"
            value={statusFilter}
            onChange={e => onStatusFilterChange(e.target.value)}
          >
            <option value="all">全部 ({totalDisplayed})</option>
            <option value="active">当前使用中</option>
            <option value="reauth">需重新登录</option>
            <option value="paused">已暂停</option>
          </select>

          {/* Tag filter placeholder */}
          <select className="cockpit-filter-select" defaultValue="all">
            <option value="all">标签筛选</option>
            <option value="work">工作主号</option>
            <option value="backup">备用号</option>
          </select>

          {/* Sort selector */}
          <select
            className="cockpit-filter-select"
            value={sortBy}
            onChange={e => onSortByChange(e.target.value as any)}
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
            title={sortOrder === "desc" ? "当前：降序，点击切换升序" : "当前：升序，点击切换降序"}
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
            title="添加新账号"
          >
            <IconPlus style={{ width: 15, height: 15 }} />
          </button>

          {/* Refresh all */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onRefreshAll}
            disabled={refreshingAll}
            title="刷新全部账号配额"
          >
            <IconRefresh
              style={{ width: 15, height: 15 }}
              className={refreshingAll ? "spin" : ""}
            />
          </button>

          {/* Sensitive / Mask toggle */}
          <button
            type="button"
            className={`cockpit-round-btn${!showSensitive ? " active" : ""}`}
            onClick={onToggleSensitive}
            title={showSensitive ? "点击隐藏/脱敏邮箱" : "点击显示完整邮箱"}
          >
            <IconEyeOff style={{ width: 15, height: 15 }} />
          </button>

          {/* Export */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onExportAll}
            title="导出全部账号配置"
          >
            <IconUpload style={{ width: 15, height: 15 }} />
          </button>

          {/* Folder */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onOpenFolder}
            title="打开配置与数据目录"
          >
            <IconFolder style={{ width: 15, height: 15 }} />
          </button>

          {/* Settings */}
          <button
            type="button"
            className="cockpit-round-btn"
            onClick={onOpenSettings}
            title="账号与配额策略设置"
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
          <span>已就绪 {totalDisplayed} 个账号</span>
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
