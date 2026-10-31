import React from "react";
import type { UnifiedAccountItem } from "../../types/account";
import { formatCockpitDate } from "./CockpitAccountCard";
import {
  IconCheck,
  IconCopy,
  IconPencil,
  IconPlay,
  IconRefresh,
  IconTrash,
} from "../../icons";

interface CockpitHealthTableProps {
  accounts: UnifiedAccountItem[];
  selectedIds: Set<string>;
  switchingId: string | null;
  refreshingId: string | null;
  copiedId: string | null;
  formatEmail: (email: string) => string;
  onToggleSelectAll: () => void;
  onToggleSelectOne: (id: string) => void;
  onSwitch: (item: UnifiedAccountItem) => void;
  onRefresh: (item: UnifiedAccountItem) => void;
  onEditAlias: (item: UnifiedAccountItem) => void;
  onCopy: (text: string, id: string) => void;
  onRemove: (item: UnifiedAccountItem) => void;
}

export const CockpitHealthTable: React.FC<CockpitHealthTableProps> = ({
  accounts,
  selectedIds,
  switchingId,
  refreshingId,
  copiedId,
  formatEmail,
  onToggleSelectAll,
  onToggleSelectOne,
  onSwitch,
  onRefresh,
  onEditAlias,
  onCopy,
  onRemove,
}) => {
  const isAllSelected = accounts.length > 0 && selectedIds.size === accounts.length;

  return (
    <div className="cockpit-table-wrap">
      <table className="cockpit-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <input
                type="checkbox"
                className="cockpit-checkbox"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
              />
            </th>
            <th>账号邮箱 / 别名</th>
            <th>提供商</th>
            <th>当前计划</th>
            <th>健康检测状态</th>
            <th>活跃状态</th>
            <th>配额概况</th>
            <th>更新时间</th>
            <th style={{ textAlign: "right" }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(acc => {
            const isCopied = copiedId === acc.id;
            const isSwitching = switchingId === acc.id;
            const isRefreshing = refreshingId === acc.id;

            return (
              <tr key={`${acc.provider}:${acc.id}`}>
                <td>
                  <input
                    type="checkbox"
                    className="cockpit-checkbox"
                    checked={selectedIds.has(acc.id)}
                    onChange={() => onToggleSelectOne(acc.id)}
                  />
                </td>
                <td>
                  <div style={{ fontWeight: 700 }}>{formatEmail(acc.email)}</div>
                  {acc.alias && (
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{acc.alias}</div>
                  )}
                </td>
                <td>
                  <span className="badge badge-muted">{acc.providerLabel}</span>
                </td>
                <td>
                  <span className="cockpit-badge-plan">{acc.plan?.toUpperCase()}</span>
                </td>
                <td>
                  <span
                    className={`badge ${
                      acc.health?.status === "healthy" ? "badge-green" : "badge-amber"
                    }`}
                  >
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
                <td style={{ fontSize: 12, minWidth: 160 }}>
                  {acc.provider === "google-antigravity" ? (
                    <span>Claude / Gemini 双配额正常</span>
                  ) : acc.provider === "xai" ? (
                    <span>
                      周配额剩余 {Math.max(0, Math.min(100, Math.round(100 - (acc.quota?.weeklyPercent ?? 0))))}%
                    </span>
                  ) : (
                    <span>
                      5-Week 剩余 {Math.max(0, Math.min(100, Math.round(100 - (acc.quota?.monthlyPercent ?? 0))))}%
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                  {formatCockpitDate(acc.updatedAt)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <div className="cockpit-card-actions" style={{ justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className={`cockpit-icon-btn ${acc.active ? "cockpit-icon-btn--active" : "cockpit-icon-btn--primary"}`}
                      title={
                        acc.active
                          ? acc.provider === "google-antigravity"
                            ? "当前正在使用的账号 (已同步至 Antigravity IDE)"
                            : "当前正在使用的账号 (已激活)"
                          : acc.provider === "google-antigravity"
                          ? "切换 Antigravity 到此账号并同步至 IDE"
                          : "设为当前账号"
                      }
                      disabled={isSwitching}
                      onClick={() => onSwitch(acc)}
                    >
                      {isSwitching ? (
                        <IconRefresh style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                      ) : (
                        <IconPlay
                          style={{
                            width: 14,
                            height: 14,
                            color: acc.active ? "#00c950" : undefined,
                          }}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title="刷新配额"
                      disabled={isRefreshing}
                      onClick={() => onRefresh(acc)}
                    >
                      <IconRefresh
                        style={{ width: 14, height: 14 }}
                        className={isRefreshing ? "spin" : ""}
                      />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title="修改别名备注"
                      onClick={() => onEditAlias(acc)}
                    >
                      <IconPencil style={{ width: 14, height: 14 }} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title={isCopied ? "已复制" : "复制邮箱"}
                      onClick={() => onCopy(acc.email || acc.id, acc.id)}
                    >
                      {isCopied ? (
                        <IconCheck style={{ width: 14, height: 14, color: "#10b981" }} />
                      ) : (
                        <IconCopy style={{ width: 14, height: 14 }} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn cockpit-icon-btn--danger"
                      title="移除账号"
                      onClick={() => onRemove(acc)}
                    >
                      <IconTrash style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

