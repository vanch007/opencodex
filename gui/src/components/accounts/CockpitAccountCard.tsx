import React from "react";
import type { UnifiedAccountItem } from "../../types/account";
import { formatAntigravityReset, AntigravityQuotaCard } from "../provider-workspace/AntigravityQuotaCard";
import {
  IconCheck,
  IconCopy,
  IconInfo,
  IconPlay,
  IconRefresh,
  IconTag,
  IconTerminal,
  IconTrash,
  IconUpload,
} from "../../icons";

interface CockpitAccountCardProps {
  account: UnifiedAccountItem;
  isSelected: boolean;
  isSwitching: boolean;
  isRefreshing: boolean;
  copiedId: string | null;
  formatEmail: (email: string) => string;
  onToggleSelect: (id: string) => void;
  onSwitch: (item: UnifiedAccountItem) => void;
  onRefresh: (item: UnifiedAccountItem) => void;
  onEditAlias: (item: UnifiedAccountItem) => void;
  onCopy: (text: string, id: string) => void;
  onRemove: (item: UnifiedAccountItem) => void;
  onShowInfo: (item: UnifiedAccountItem) => void;
  onExport: (item: UnifiedAccountItem) => void;
}

export function formatCockpitDate(ts?: number | string): string {
  if (!ts) return "2026/09/28 16:15";
  const date = typeof ts === "string" ? new Date(ts) : new Date(ts < 10_000_000_000 ? ts * 1000 : ts);
  if (isNaN(date.getTime())) return "2026/09/28 16:15";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

export const CockpitAccountCard: React.FC<CockpitAccountCardProps> = ({
  account: acc,
  isSelected,
  isSwitching,
  isRefreshing,
  copiedId,
  formatEmail,
  onToggleSelect,
  onSwitch,
  onRefresh,
  onEditAlias,
  onCopy,
  onRemove,
  onShowInfo,
  onExport,
}) => {
  const isAntigravity = acc.provider === "google-antigravity";
  const isGrok = acc.provider === "xai";
  const isCopied = copiedId === acc.id;

  // Plan styling
  const planText = isGrok
    ? "GROK"
    : (acc.plan === "g1-pro-tier" || acc.plan === "pro")
      ? "PRO"
      : acc.plan === "plus"
        ? "PLUS"
        : (acc.plan ?? "FREE").toUpperCase();

  const planClass = isGrok
    ? "cockpit-badge-plan cockpit-badge-plan--grok"
    : (planText === "PRO")
      ? "cockpit-badge-plan"
      : planText === "PLUS"
        ? "cockpit-badge-plan cockpit-badge-plan--plus"
        : "cockpit-badge-plan cockpit-badge-plan--free";

  return (
    <div className={`cockpit-card${acc.active ? " cockpit-card--active" : ""}`}>
      {/* ── Card Header ── */}
      <div className="cockpit-card-head">
        <div className="cockpit-card-title-group">
          <input
            type="checkbox"
            className="cockpit-checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(acc.id)}
          />
          <span className="cockpit-card-email" title={acc.email || acc.id}>
            {formatEmail(acc.email)}
          </span>
        </div>
        <div className="cockpit-card-badges">
          {acc.active && <span className="cockpit-badge-active">当前</span>}
          <span className={planClass}>{planText}</span>
        </div>
      </div>

      {/* ── Card Body ── */}
      <div className="cockpit-card-body">
        {isAntigravity ? (
          <AntigravityQuotaCard quota={acc.quota} pending={acc.quotaPending} />
        ) : isGrok ? (
          /* xAI Grok Card Body */
          <div className="cockpit-codex-body">
            {/* Team & Memo Row */}
            <div className="cockpit-codex-top-row">
              <span className="cockpit-codex-team">Team: {acc.teamName || "xAI 官方账户"}</span>
              <button
                type="button"
                className="cockpit-mini-btn"
                onClick={() => onEditAlias(acc)}
                title="修改备注别名"
              >
                加备注
              </button>
              <button
                type="button"
                className="cockpit-mini-btn"
                onClick={() => onRefresh(acc)}
                title="刷新配额"
              >
                ↻ 刷新
              </button>
            </div>

            {/* Login & User ID */}
            <div className="cockpit-codex-meta">
              <span>{acc.loginMethod || "xAI OAuth 授权"} | ID: {acc.id}</span>
              {acc.alias && <span style={{ color: "var(--text)" }}>别名: {acc.alias}</span>}
            </div>

            {/* Weekly Quota Row */}
            {(() => {
              const usedPct = acc.quota?.weeklyPercent ?? 0;
              const remainPct = Math.max(0, Math.min(100, Math.round(100 - usedPct)));
              const toneClass = remainPct < 50
                ? "ag-quota-pct--danger"
                : remainPct < 80
                  ? "ag-quota-pct--warn"
                  : "ag-quota-pct--healthy";
              const barToneClass = remainPct < 50
                ? "ag-quota-bar-fill--danger"
                : remainPct < 80
                  ? "ag-quota-bar-fill--warn"
                  : "ag-quota-bar-fill--healthy";

              return (
                <div className="cockpit-codex-quota-row">
                  <div className="cockpit-codex-quota-head">
                    <span className="cockpit-codex-quota-title">
                      <span style={{ marginRight: 4 }}>🕒</span>
                      周配额 (Weekly)
                    </span>
                    <span className={`ag-quota-pct ${toneClass}`}>{remainPct}%</span>
                  </div>
                  <div className="ag-quota-bar-track">
                    <div
                      className={`ag-quota-bar-fill ${barToneClass}`}
                      style={{ width: `${remainPct}%` }}
                    />
                  </div>
                  {acc.quota?.weeklyResetAt && (
                    <div className="ag-quota-reset">
                      {formatAntigravityReset(acc.quota.weeklyResetAt)}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Expiry / Status Box */}
            <div className={`cockpit-codex-expiry${acc.paused ? "" : " cockpit-codex-expiry--ok"}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>📅 授权状态</span>
                <span style={{ fontWeight: 700 }}>{acc.paused ? "已暂停" : "正常有效"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {formatCockpitDate(acc.updatedAt || Date.now())}
                </span>
                <span
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => onRefresh(acc)}
                >
                  刷新
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* OpenAI / Codex Card Body */
          <div className="cockpit-codex-body">
            {/* Team & Memo Row */}
            <div className="cockpit-codex-top-row">
              <span className="cockpit-codex-team">Team Name: {acc.teamName || "个人账户"}</span>
              <button
                type="button"
                className="cockpit-mini-btn"
                onClick={() => onEditAlias(acc)}
                title="修改备注别名"
              >
                加备注
              </button>
              <button
                type="button"
                className="cockpit-mini-btn"
                onClick={() => onRefresh(acc)}
                title="重置配额状态"
              >
                ↻ 重置 {acc.resetCount ?? 0}
              </button>
            </div>

            {/* Login & User ID */}
            <div className="cockpit-codex-meta">
              <span>
                {acc.loginMethod || "使用 Google 登录"} | 用户 ID: {acc.id.length > 22 ? `${acc.id.slice(0, 18)}...` : acc.id}
              </span>
              {acc.alias && <span style={{ color: "var(--text)" }}>别名: {acc.alias}</span>}
            </div>

            {/* 5-Week Quota Row */}
            {(() => {
              const usedPct = acc.quota?.monthlyPercent ?? 0;
              const remainPct = Math.max(0, Math.min(100, Math.round(100 - usedPct)));
              const toneClass = remainPct < 50
                ? "ag-quota-pct--danger"
                : remainPct < 80
                  ? "ag-quota-pct--warn"
                  : "ag-quota-pct--healthy";
              const barToneClass = remainPct < 50
                ? "ag-quota-bar-fill--danger"
                : remainPct < 80
                  ? "ag-quota-bar-fill--warn"
                  : "ag-quota-bar-fill--healthy";

              return (
                <div className="cockpit-codex-quota-row">
                  <div className="cockpit-codex-quota-head">
                    <span className="cockpit-codex-quota-title">
                      <span style={{ marginRight: 4 }}>🕒</span>
                      5 Week
                    </span>
                    <span className={`ag-quota-pct ${toneClass}`}>{remainPct}%</span>
                  </div>
                  <div className="ag-quota-bar-track">
                    <div
                      className={`ag-quota-bar-fill ${barToneClass}`}
                      style={{ width: `${remainPct}%` }}
                    />
                  </div>
                  {acc.quota?.monthlyResetAt && (
                    <div className="ag-quota-reset">
                      {formatAntigravityReset(acc.quota.monthlyResetAt)}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Expiry / Status Box */}
            <div className={`cockpit-codex-expiry${acc.paused ? "" : " cockpit-codex-expiry--ok"}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>📅 有效期</span>
                <span style={{ fontWeight: 700 }}>{acc.paused ? "已过期" : "正常有效"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {formatCockpitDate(acc.updatedAt || Date.now())}
                </span>
                <span
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => onRefresh(acc)}
                >
                  刷新
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Card Footer ── */}
      <div className="cockpit-card-foot">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="cockpit-card-date">
            {formatCockpitDate(acc.createdAt || acc.updatedAt)}
          </span>
          {!isAntigravity && (
            <span className="cockpit-standard-badge">标准 ⌄</span>
          )}
        </div>

        {/* Action Icons in Cockpit Layout Order */}
        <div className="cockpit-card-actions">
          {!isAntigravity && (
            <button
              type="button"
              className="cockpit-icon-btn"
              title="控制台终端"
              onClick={() => onShowInfo(acc)}
            >
              <IconTerminal style={{ width: 14, height: 14 }} />
            </button>
          )}
          {isAntigravity && (
            <button
              type="button"
              className="cockpit-icon-btn"
              title="账号详情"
              onClick={() => onShowInfo(acc)}
            >
              <IconInfo style={{ width: 14, height: 14 }} />
            </button>
          )}
          <button
            type="button"
            className="cockpit-icon-btn"
            title="加备注 / 标签"
            onClick={() => onEditAlias(acc)}
          >
            <IconTag style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            className="cockpit-icon-btn"
            title={isCopied ? "已复制" : "复制账号邮箱"}
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
            className={`cockpit-icon-btn ${acc.active ? "cockpit-icon-btn--active" : "cockpit-icon-btn--primary"}`}
            title={acc.active ? "当前正在使用的账号 (已激活)" : "激活设为当前账号"}
            disabled={isSwitching}
            onClick={() => onSwitch(acc)}
          >
            <IconPlay
              style={{
                width: 14,
                height: 14,
                color: acc.active ? "#00c950" : undefined,
              }}
            />
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
            title="导出账号配置"
            onClick={() => onExport(acc)}
          >
            <IconUpload style={{ width: 14, height: 14 }} />
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
      </div>
    </div>
  );
};
