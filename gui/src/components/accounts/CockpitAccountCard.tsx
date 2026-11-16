import React from "react";
import { accountHasArgonTier, type UnifiedAccountItem } from "../../types/account";
import { formatAntigravityReset, AntigravityQuotaCard } from "../provider-workspace/AntigravityQuotaCard";
import {
  IconActivity,
  IconCheck,
  IconCopy,
  IconInfo,
  IconPause,
  IconPlay,
  IconPower,
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
  isTestingHealth?: boolean;
  pausingId?: string | null;
  copiedId: string | null;
  formatEmail: (email: string) => string;
  onToggleSelect: (id: string) => void;
  onSwitch: (item: UnifiedAccountItem) => void;
  onRefresh: (item: UnifiedAccountItem) => void;
  onTogglePause?: (item: UnifiedAccountItem, paused: boolean) => void;
  onTestHealth?: (item: UnifiedAccountItem) => void;
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
  isTestingHealth = false,
  pausingId = null,
  copiedId,
  formatEmail,
  onToggleSelect,
  onSwitch,
  onRefresh,
  onTogglePause,
  onTestHealth,
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
  const pLower = (acc.plan ?? "").toLowerCase();
  const isFree = pLower.includes("free");
  const isUltra = pLower.includes("ultra");
  const isPro = pLower.includes("pro") || pLower === "g1-pro-tier";
  const isPlus = pLower.includes("plus");

  const planText = isGrok
    ? "GROK"
    : isUltra
      ? "ULTRA"
      : isPro
        ? "PRO"
        : isPlus
          ? "PLUS"
          : isFree
            ? "FREE-TIER"
            : (acc.plan ?? "FREE").toUpperCase();

  const planClass = isGrok
    ? "cockpit-badge-plan cockpit-badge-plan--grok"
    : isUltra
      ? "cockpit-badge-plan cockpit-badge-plan--ultra"
      : isPro
        ? "cockpit-badge-plan"
        : isPlus
          ? "cockpit-badge-plan cockpit-badge-plan--plus"
          : "cockpit-badge-plan cockpit-badge-plan--free";

  const hasArgon = accountHasArgonTier(acc);

  return (
    <div
      className={`cockpit-card${acc.active ? " cockpit-card--active" : ""}`}
      style={{
        opacity: acc.paused ? 0.65 : 1,
        transition: "opacity 0.2s ease, background 0.2s ease",
      }}
    >
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
          {acc.paused ? (
            <span
              className="badge"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#f87171",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 5px",
              }}
              title="已停用：不参与调度与路由"
            >
              已停用
            </span>
          ) : acc.healthTest && !acc.healthTest.ok ? (
            <span
              className="badge"
              style={{
                background: acc.healthTest.status === 403 ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                color: acc.healthTest.status === 403 ? "#f87171" : "#fbbf24",
                border: `1px solid ${acc.healthTest.status === 403 ? "rgba(239, 68, 68, 0.35)" : "rgba(245, 158, 11, 0.35)"}`,
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 5px",
              }}
              title={`探测异常 (${acc.healthTest.status}): ${acc.healthTest.message}`}
            >
              {acc.healthTest.status === 403 ? "403失效" : acc.healthTest.status === 504 ? "504超时" : "异常"}
            </span>
          ) : acc.health?.status === "reauth_required" ? (
            <span
              className="badge"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#f87171",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 5px",
              }}
              title="需重新登录授权"
            >
              需授权
            </span>
          ) : null}
          {acc.active && <span className="cockpit-badge-active">当前</span>}
          {isAntigravity && (
            hasArgon ? (
              <span
                className="badge"
                style={{
                  background: "rgba(168, 85, 247, 0.15)",
                  color: "#c084fc",
                  border: "1px solid rgba(168, 85, 247, 0.35)",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 5px",
                }}
                title="高阶账号: 支持 Gemini 4 Argon 及 Claude 5.5 (全模型)"
              >
                🌟 Argon+C5.5
              </span>
            ) : (
              <span
                className="badge"
                style={{
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59, 130, 246, 0.35)",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 5px",
                }}
                title="基础账号: 仅支持 Gemini 3.8 Flash 与 Claude 4.6"
              >
                ⚡ Flash+C4.6
              </span>
            )
          )}
          <span className={planClass}>{planText}</span>
        </div>
      </div>

      {/* ── Card Body ── */}
      <div className="cockpit-card-body">
        {isAntigravity ? (
          <AntigravityQuotaCard quota={acc.quota} pending={acc.quotaPending} hideArgon={!hasArgon} plan={acc.plan} />
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
                data-tip="修改备注别名"
              >
                加备注
              </button>
              <button
                type="button"
                className="cockpit-mini-btn"
                onClick={() => onRefresh(acc)}
                data-tip="刷新配额"
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
                data-tip="修改备注别名"
              >
                加备注
              </button>
              <button
                type="button"
                className="cockpit-mini-btn"
                onClick={() => onRefresh(acc)}
                data-tip="重置配额状态"
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
              data-tip="控制台终端"
              onClick={() => onShowInfo(acc)}
            >
              <IconTerminal style={{ width: 14, height: 14 }} />
            </button>
          )}
          {isAntigravity && (
            <button
              type="button"
              className="cockpit-icon-btn"
              data-tip="账号详情"
              onClick={() => onShowInfo(acc)}
            >
              <IconInfo style={{ width: 14, height: 14 }} />
            </button>
          )}
          <button
            type="button"
            className="cockpit-icon-btn"
            data-tip="加备注 / 标签"
            onClick={() => onEditAlias(acc)}
          >
            <IconTag style={{ width: 14, height: 14 }} />
          </button>
          {onTestHealth && (
            <button
              type="button"
              className="cockpit-icon-btn"
              data-tip="真实模型调用健康检测 (向上游发起极简 Prompt 探测真实可用性与连通性)"
              disabled={isTestingHealth}
              onClick={() => onTestHealth(acc)}
            >
              <IconActivity
                style={{
                  width: 14,
                  height: 14,
                  color: isTestingHealth ? "#f59e0b" : "#38bdf8",
                }}
                className={isTestingHealth ? "spin" : ""}
              />
            </button>
          )}
          {onTogglePause && (
            <button
              type="button"
              className={`cockpit-icon-btn ${acc.paused ? "cockpit-icon-btn--primary" : ""}`}
              data-tip={acc.paused ? "恢复启用此账号 (重新加入调度池)" : "停用此账号 (隔离故障，不参与调度与路由)"}
              disabled={pausingId === acc.id}
              onClick={() => onTogglePause(acc, !acc.paused)}
            >
              {pausingId === acc.id ? (
                <IconRefresh style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
              ) : acc.paused ? (
                <IconPower style={{ width: 14, height: 14, color: "#34d399" }} />
              ) : (
                <IconPause
                  style={{
                    width: 14,
                    height: 14,
                    color: acc.healthTest && !acc.healthTest.ok ? "#f87171" : "var(--muted)",
                  }}
                />
              )}
            </button>
          )}
          <button
            type="button"
            className="cockpit-icon-btn"
            data-tip={isCopied ? "已复制" : "复制账号邮箱"}
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
            data-tip={
              acc.active
                ? isAntigravity
                  ? "当前正在使用的账号 (已同步至 Antigravity IDE)"
                  : "当前正在使用的账号 (已激活)"
                : isAntigravity
                ? "切换 Antigravity 到此账号并同步至 IDE"
                : "激活设为当前账号"
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
            data-tip="刷新配额"
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
            data-tip="导出账号配置"
            onClick={() => onExport(acc)}
          >
            <IconUpload style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            className="cockpit-icon-btn cockpit-icon-btn--danger"
            data-tip="移除账号"
            onClick={() => onRemove(acc)}
          >
            <IconTrash style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>
    </div>
  );
};
