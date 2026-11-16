import React from "react";
import { accountHasArgonTier, accountIsUnusable, type UnifiedAccountItem } from "../../types/account";
import { formatCockpitDate } from "./CockpitAccountCard";
import {
  IconActivity,
  IconCheck,
  IconCopy,
  IconPause,
  IconPencil,
  IconPlay,
  IconPower,
  IconRefresh,
  IconTrash,
} from "../../icons";

interface CockpitHealthTableProps {
  accounts: UnifiedAccountItem[];
  selectedIds: Set<string>;
  switchingId: string | null;
  refreshingId: string | null;
  copiedId: string | null;
  testingHealthIds?: Set<string>;
  isTestingAll?: boolean;
  pausingId?: string | null;
  isBatchPausing?: boolean;
  formatEmail: (email: string) => string;
  onToggleSelectAll: () => void;
  onToggleSelectOne: (id: string) => void;
  onSwitch: (item: UnifiedAccountItem) => void;
  onRefresh: (item: UnifiedAccountItem) => void;
  onTogglePause?: (item: UnifiedAccountItem, paused: boolean) => void;
  onPauseAllUnusable?: () => void;
  onTestHealth?: (item: UnifiedAccountItem) => void;
  onTestAllHealth?: () => void;
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
  testingHealthIds = new Set(),
  isTestingAll = false,
  pausingId = null,
  isBatchPausing = false,
  formatEmail,
  onToggleSelectAll,
  onToggleSelectOne,
  onSwitch,
  onRefresh,
  onTogglePause,
  onPauseAllUnusable,
  onTestHealth,
  onTestAllHealth,
  onEditAlias,
  onCopy,
  onRemove,
}) => {
  const isAllSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const unusableCount = accounts.filter(
    a => !a.paused && accountIsUnusable(a),
  ).length;

  return (
    <div className="cockpit-table-wrap">
      {onTestAllHealth && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            已就绪 <strong>{accounts.length}</strong> 个账号 · 支持区别显示高阶与基础配额，使用真实模型探测健康
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onPauseAllUnusable && unusableCount > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#f87171",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  borderRadius: 6,
                  padding: "3px 10px",
                  background: "rgba(239, 68, 68, 0.12)",
                  fontWeight: 600,
                  cursor: isBatchPausing ? "not-allowed" : "pointer",
                }}
                disabled={isBatchPausing}
                onClick={onPauseAllUnusable}
                data-tip="批量停用所有探测失败 (403/504等) 的账号，防止请求分发至故障账号"
              >
                <IconPause style={{ width: 14, height: 14 }} />
                <span>{isBatchPausing ? "正在批量停用..." : `一键停用异常账号 (${unusableCount})`}</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.3)", borderRadius: 6, padding: "3px 10px", background: "rgba(56, 189, 248, 0.08)" }}
              disabled={isTestingAll}
              onClick={onTestAllHealth}
              data-tip="并发向上游发起真实模型 Prompt 探测，测试所有账号可用性"
            >
              <IconActivity style={{ width: 14, height: 14 }} className={isTestingAll ? "spin" : ""} />
              <span>{isTestingAll ? "正在批量测试健康..." : "一键真实模型检测 (全部账号)"}</span>
            </button>
          </div>
        </div>
      )}
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
            const isTestingHealth = testingHealthIds.has(acc.id);

            // Antigravity quota breakdown
            const windows = acc.quota?.customWindows ?? [];
            const findWin = (prefix: string, isWeekly: boolean) => {
              return windows.find(w => {
                const l = w.label.toLowerCase();
                const matches = l.startsWith(prefix.toLowerCase()) || l.includes(prefix.toLowerCase());
                const weekly = l.includes("week");
                return matches && (isWeekly ? weekly : !weekly);
              });
            };
            const hasArgon = accountHasArgonTier(acc);

            const getRemaining = (w?: (typeof windows)[0]) => {
              if (!w) return 100;
              const used = typeof w.percent === "number" && Number.isFinite(w.percent) ? w.percent : 0;
              return Math.max(0, Math.min(100, Math.round(100 - used)));
            };

            const claWeeklyRem = getRemaining(findWin("cla", true));
            const gemWeeklyRem = getRemaining(findWin("gem", true));
            const argonWeeklyRem = hasArgon ? getRemaining(findWin("argon", true)) : null;

            const pLower = (acc.plan ?? "").toLowerCase();
            const isFree = pLower.includes("free");
            const isUltra = pLower.includes("ultra");
            const isPro = pLower.includes("pro") || pLower === "g1-pro-tier";
            const isPlus = pLower.includes("plus");
            const isGrok = acc.provider === "xai";
            const planClass = isGrok
              ? "cockpit-badge-plan cockpit-badge-plan--grok"
              : isUltra
                ? "cockpit-badge-plan cockpit-badge-plan--ultra"
                : isPro
                  ? "cockpit-badge-plan"
                  : isPlus
                    ? "cockpit-badge-plan cockpit-badge-plan--plus"
                    : isFree
                      ? "cockpit-badge-plan cockpit-badge-plan--free"
                      : "cockpit-badge-plan cockpit-badge-plan--free";

            const isUnusable = accountIsUnusable(acc);

            return (
              <tr
                key={`${acc.provider}:${acc.id}`}
                style={{
                  opacity: acc.paused ? 0.6 : 1,
                  background: acc.paused ? "rgba(0,0,0,0.1)" : isUnusable ? "rgba(239, 68, 68, 0.04)" : undefined,
                  transition: "opacity 0.2s ease, background 0.2s ease",
                }}
              >
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
                  <span className={planClass}>{acc.plan?.toUpperCase()}</span>
                </td>
                <td>
                  {/* Real model health check status */}
                  {isTestingHealth ? (
                    <span className="badge badge-amber" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <IconRefresh style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />
                      <span>真实探测中...</span>
                    </span>
                  ) : acc.healthTest ? (
                    acc.healthTest.ok ? (
                      <span
                        className="badge badge-green"
                        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                        title={`真实模型调用: 200 OK (${acc.healthTest.model})\n响应耗时: ${Math.round(acc.healthTest.durationMs)}ms\n探测时间: ${new Date(acc.healthTest.testedAt).toLocaleTimeString()}`}
                      >
                        <span>● 200 OK</span>
                        <span style={{ opacity: 0.8, fontSize: 10 }}>({Math.round(acc.healthTest.durationMs)}ms)</span>
                      </span>
                    ) : (
                      <span
                        className="badge"
                        style={{
                          background: acc.healthTest.status === 404 ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          color: acc.healthTest.status === 404 ? "#fbbf24" : "#f87171",
                          border: `1px solid ${acc.healthTest.status === 404 ? "rgba(245, 158, 11, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                        title={`探测失败: ${acc.healthTest.message}\nHTTP ${acc.healthTest.status}\n模型: ${acc.healthTest.model}`}
                      >
                        <span>●</span>
                        <span>
                          {acc.healthTest.status === 403 || acc.healthTest.status === 401
                            ? "403 权限失效"
                            : acc.healthTest.status === 404
                            ? "404 不支持"
                            : acc.healthTest.status === 429
                            ? "429 额度耗尽"
                            : acc.healthTest.status === 504
                            ? "504 超时"
                            : `${acc.healthTest.status} 异常`}
                        </span>
                      </span>
                    )
                  ) : acc.paused ? (
                    <span
                      className="badge badge-muted"
                      title="账号当前已停用，点击一键检测或右侧心跳图标可重新探测是否恢复"
                    >
                      已停用
                    </span>
                  ) : (
                    <span
                      className={`badge ${
                        acc.health?.status === "healthy" ? "badge-green" : "badge-amber"
                      }`}
                      title="尚未发起本次会话真实调用探测，点击操作栏心跳图标测试"
                    >
                      {acc.health?.status ?? "healthy"}
                    </span>
                  )}
                </td>
                <td>
                  {acc.paused ? (
                    <span
                      className="badge"
                      style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        color: "#f87171",
                        border: "1px solid rgba(239, 68, 68, 0.35)",
                        fontWeight: 600,
                        fontSize: 11,
                        padding: "3px 8px",
                      }}
                      title="账号已被停用，已从调度池和路由中排除，不会处理任何请求"
                    >
                      ● 已停用
                    </span>
                  ) : acc.healthTest && !acc.healthTest.ok ? (
                    <span
                      className="badge"
                      style={{
                        background: acc.healthTest.status === 403 ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        color: acc.healthTest.status === 403 ? "#f87171" : "#fbbf24",
                        border: `1px solid ${acc.healthTest.status === 403 ? "rgba(239, 68, 68, 0.35)" : "rgba(245, 158, 11, 0.35)"}`,
                        fontWeight: 600,
                        fontSize: 11,
                        padding: "3px 8px",
                      }}
                      title={`探测异常 (${acc.healthTest.status}): ${acc.healthTest.message}，点击操作栏暂停或一键停用`}
                    >
                      {acc.healthTest.status === 403 ? "⚠️ 权限失效" : acc.healthTest.status === 429 ? "额度耗尽" : acc.healthTest.status === 504 ? "⚠️ 超时异常" : "⚠️ 状态异常"}
                    </span>
                  ) : acc.health?.status === "reauth_required" ? (
                    <span
                      className="badge"
                      style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        color: "#f87171",
                        border: "1px solid rgba(239, 68, 68, 0.35)",
                        fontWeight: 600,
                        fontSize: 11,
                        padding: "3px 8px",
                      }}
                      title="凭据失效，需要重新登录授权"
                    >
                      ● 需重新授权
                    </span>
                  ) : acc.active ? (
                    <span className="cockpit-badge-active">当前使用中</span>
                  ) : (
                    <span style={{ color: "#34d399", fontSize: 12, fontWeight: 500 }}>● 备用就绪</span>
                  )}
                </td>
                <td style={{ fontSize: 12, minWidth: 200 }}>
                  {acc.provider === "google-antigravity" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {hasArgon ? (
                          <span
                            className="badge"
                            style={{
                              background: "rgba(168, 85, 247, 0.15)",
                              color: "#c084fc",
                              border: "1px solid rgba(168, 85, 247, 0.35)",
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 6px",
                            }}
                            title="该账号支持 Gemini 4 Argon 及 Claude 5.5 (全模型)"
                          >
                            🌟 Argon + Claude 5.5
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{
                              background: "rgba(59, 130, 246, 0.15)",
                              color: "#60a5fa",
                              border: "1px solid rgba(59, 130, 246, 0.35)",
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 6px",
                            }}
                            title="该账号仅支持基础模型: Gemini 3.8 Flash 与 Claude 4.6"
                          >
                            ⚡ Flash + Claude 4.6
                          </span>
                        )}
                        {argonWeeklyRem === 0 && (
                          <span
                            className="badge"
                            style={{ background: "rgba(239, 68, 68, 0.15)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.3)", fontSize: 10, padding: "1px 5px" }}
                          >
                            Argon周额用尽
                          </span>
                        )}
                        {claWeeklyRem === 0 && (
                          <span
                            className="badge"
                            style={{ background: "rgba(239, 68, 68, 0.15)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.3)", fontSize: 10, padding: "1px 5px" }}
                          >
                            Claude周额用尽
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 10 }}>
                        <span>Cla周: <strong style={{ color: claWeeklyRem > 20 ? "#34d399" : "#f87171" }}>{claWeeklyRem}%</strong></span>
                        <span>Gem周: <strong style={{ color: gemWeeklyRem > 20 ? "#34d399" : "#f87171" }}>{gemWeeklyRem}%</strong></span>
                        {argonWeeklyRem !== null && (
                          <span>Argon周: <strong style={{ color: argonWeeklyRem > 0 ? "#c084fc" : "#f87171" }}>{argonWeeklyRem}%</strong></span>
                        )}
                      </div>
                    </div>
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
                    {/* Real model health test button */}
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      data-tip="真实模型调用健康检测 (向上游发起极简 Prompt 探测真实可用性与连通性)"
                      disabled={isTestingHealth}
                      onClick={() => onTestHealth?.(acc)}
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
                    {/* Pause / Resume account toggle button */}
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
                      className={`cockpit-icon-btn ${acc.active ? "cockpit-icon-btn--active" : "cockpit-icon-btn--primary"}`}
                      data-tip={
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
                      data-tip="修改别名备注"
                      onClick={() => onEditAlias(acc)}
                    >
                      <IconPencil style={{ width: 14, height: 14 }} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      data-tip={isCopied ? "已复制" : "复制邮箱"}
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
                      data-tip="移除账号"
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
