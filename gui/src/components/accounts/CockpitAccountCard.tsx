import React from "react";
import { type EmailAccountGroup, type UnifiedAccountItem } from "../../types/account";
import { AntigravityQuotaCard, formatAntigravityReset } from "../provider-workspace/AntigravityQuotaCard";
import { formatCompactTokens, quotaToneClasses } from "./email-account-groups";
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
  IconTrash,
  IconUpload,
} from "../../icons";

interface CockpitAccountCardProps {
  group: EmailAccountGroup;
  isSelected: boolean;
  switchingId: string | null;
  refreshingId: string | null;
  testingHealthIds?: Set<string>;
  pausingId?: string | null;
  copiedId: string | null;
  formatEmail: (email: string) => string;
  onToggleSelect: (emailKey: string) => void;
  onSwitch: (item: UnifiedAccountItem) => void;
  onRefresh: (item: UnifiedAccountItem) => void;
  onRefreshGroup: (group: EmailAccountGroup) => void;
  onTogglePause?: (item: UnifiedAccountItem, paused: boolean) => void;
  onTestHealth?: (item: UnifiedAccountItem) => void;
  onEditAlias: (item: UnifiedAccountItem) => void;
  onEditAiStudioKey: (group: EmailAccountGroup) => void;
  onAddPlatform: (email: string, provider: "google-antigravity" | "openai" | "xai") => void;
  onCopy: (text: string, id: string) => void;
  onRemoveGroup: (group: EmailAccountGroup) => void;
  onRemovePlatform?: (
    group: EmailAccountGroup,
    platform: "antigravity" | "aiStudio" | "chatgpt" | "grok",
  ) => void;
  onShowInfo: (group: EmailAccountGroup) => void;
  onExport: (group: EmailAccountGroup) => void;
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

function getPlanBadge(plan?: string | null): { text: string; className: string } {
  const p = (plan ?? "").toLowerCase();
  if (p.includes("ultra")) return { text: "ULTRA", className: "cockpit-badge-plan cockpit-badge-plan--ultra" };
  if (p.includes("pro") || p === "g1-pro-tier") return { text: "PRO", className: "cockpit-badge-plan" };
  if (p.includes("plus")) return { text: "PLUS", className: "cockpit-badge-plan cockpit-badge-plan--plus" };
  if (p.includes("free")) return { text: "FREE", className: "cockpit-badge-plan cockpit-badge-plan--free" };
  return { text: (plan ?? "FREE").toUpperCase(), className: "cockpit-badge-plan cockpit-badge-plan--free" };
}

export const CockpitAccountCard: React.FC<CockpitAccountCardProps> = ({
  group,
  isSelected,
  switchingId,
  refreshingId,
  testingHealthIds = new Set(),
  pausingId = null,
  copiedId,
  formatEmail,
  onToggleSelect,
  onSwitch,
  onRefresh,
  onRefreshGroup,
  onTogglePause,
  onTestHealth,
  onEditAlias,
  onEditAiStudioKey,
  onAddPlatform,
  onCopy,
  onRemoveGroup,
  onRemovePlatform,
  onShowInfo,
  onExport,
}) => {
  const ag = group.antigravity;
  const ai = group.aiStudio;
  const cg = group.chatgpt;
  const gk = group.grok;
  const primaryOAuth = ag ?? gk ?? cg;
  const isCopied = copiedId === group.emailKey;
  const isTestingHealth = Boolean((ag && testingHealthIds.has(ag.id)) || (gk && testingHealthIds.has(gk.id)));
  const isRefreshingGroup = Boolean(
    (ag && refreshingId === ag.id) || (cg && refreshingId === cg.id) || (gk && refreshingId === gk.id),
  );
  const planBadge = getPlanBadge(group.primaryPlan);

  return (
    <div
      className={`cockpit-card${group.anyActive ? " cockpit-card--active" : ""}`}
      style={{
        opacity: group.allPaused ? 0.65 : 1,
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
            onChange={() => onToggleSelect(group.emailKey)}
          />
          <div style={{ minWidth: 0 }}>
            <div className="cockpit-card-email" title={group.email}>
              {formatEmail(group.email)}
            </div>
            {group.alias && (
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{group.alias}</div>
            )}
          </div>
        </div>
        <div className="cockpit-card-badges">
          {group.allPaused ? (
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
            >
              已停用
            </span>
          ) : group.anyUnusable ? (
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
            >
              异常
            </span>
          ) : null}
          {group.anyActive && <span className="cockpit-badge-active">当前</span>}
          {ag && (
            <span
              className="badge"
              style={{
                background: group.hasArgon ? "rgba(168, 85, 247, 0.15)" : "rgba(59, 130, 246, 0.15)",
                color: group.hasArgon ? "#c084fc" : "#60a5fa",
                border: `1px solid ${group.hasArgon ? "rgba(168, 85, 247, 0.35)" : "rgba(59, 130, 246, 0.35)"}`,
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 5px",
              }}
              title={group.hasArgon ? "高阶账号: 支持 Gemini 4 Argon + Claude 5.5" : "基础账号: 支持 Hydrogen + Flash + Claude 4.6"}
            >
              {group.hasArgon ? "🌟 Argon" : "⚡ Flash"}
            </span>
          )}
          <span className={planBadge.className}>{planBadge.text}</span>
        </div>
      </div>

      {/* ── Merged Four-Channel Sections ── */}
      <div className="cockpit-card-body">
        <div className="cockpit-channel-sections">
          {/* 1. Antigravity */}
          {ag ? (
            <div className="cockpit-channel-box" style={{ padding: "8px 10px" }}>
              <div className="cockpit-channel-box-head">
                <div className="cockpit-channel-title">
                  <span>🌐 Antigravity</span>
                  {ag.active && <span className="cockpit-badge-active" style={{ fontSize: 9.5, padding: "0 5px" }}>使用中</span>}
                  {ag.paused && <span style={{ fontSize: 10, color: "#f87171" }}>已停用</span>}
                  {ag.healthTest && (
                    <span style={{ fontSize: 10, color: ag.healthTest.ok ? "#10b981" : "#f87171" }}>
                      {ag.healthTest.ok ? "200 OK" : `${ag.healthTest.status}`}
                    </span>
                  )}
                </div>
                <div className="cockpit-channel-mini-actions">
                  <button
                    type="button"
                    className={`cockpit-icon-btn ${ag.active ? "cockpit-icon-btn--active" : "cockpit-icon-btn--primary"}`}
                    style={{ width: 22, height: 22 }}
                    data-tip={ag.active ? "Antigravity 当前账号" : "切换 Antigravity 到此账号"}
                    disabled={switchingId === ag.id}
                    onClick={() => onSwitch(ag)}
                  >
                    <IconPlay style={{ width: 12, height: 12 }} />
                  </button>
                  <button
                    type="button"
                    className="cockpit-icon-btn"
                    style={{ width: 22, height: 22 }}
                    data-tip="刷新 Antigravity 配额"
                    disabled={refreshingId === ag.id}
                    onClick={() => onRefresh(ag)}
                  >
                    <IconRefresh style={{ width: 12, height: 12 }} className={refreshingId === ag.id ? "spin" : ""} />
                  </button>
                  {onTogglePause && (
                    <button
                      type="button"
                      className={`cockpit-icon-btn ${ag.paused ? "cockpit-icon-btn--primary" : ""}`}
                      style={{ width: 22, height: 22 }}
                      data-tip={ag.paused ? "恢复 Antigravity" : "暂停 Antigravity"}
                      disabled={pausingId === ag.id}
                      onClick={() => onTogglePause(ag, !ag.paused)}
                    >
                      {pausingId === ag.id ? (
                        <IconRefresh style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                      ) : ag.paused ? (
                        <IconPower style={{ width: 12, height: 12, color: "#34d399" }} />
                      ) : (
                        <IconPause style={{ width: 12, height: 12 }} />
                      )}
                    </button>
                  )}
                  {onRemovePlatform && (
                    <button
                      type="button"
                      className="cockpit-icon-btn cockpit-icon-btn--danger"
                      style={{ width: 22, height: 22 }}
                      data-tip="移除 Antigravity 授权"
                      onClick={() => onRemovePlatform(group, "antigravity")}
                    >
                      <IconTrash style={{ width: 12, height: 12 }} />
                    </button>
                  )}
                </div>
              </div>
              <AntigravityQuotaCard quota={ag.quota} pending={ag.quotaPending} hideArgon={!group.hasArgon} plan={ag.plan} />
            </div>
          ) : (
            <div className="cockpit-channel-box cockpit-channel-box--empty">
              <span className="cockpit-channel-title" style={{ color: "var(--muted)" }}>🌐 Antigravity</span>
              <button
                type="button"
                className="cockpit-channel-add-btn"
                onClick={() => onAddPlatform(group.email, "google-antigravity")}
              >
                + 添加 Antigravity
              </button>
            </div>
          )}

          {/* 2. AI Studio (Local Stats) */}
          {ai ? (
            (() => {
              const q = ai.quota;
              const remPct = q?.remainingPercent ?? 100;
              const tones = quotaToneClasses(remPct);
              const reqUsed = q?.requestsToday ?? 0;
              const reqLimit = q?.dailyRequestLimit ?? (ai.planTier === "ultra" ? 200 : ai.planTier === "pro" ? 100 : 50);
              const tokUsed = q?.tokensToday ?? 0;
              const tokLimit = q?.dailyTokenLimit ?? (ai.planTier === "free" ? 10_000_000 : 25_000_000);
              return (
                <div className="cockpit-channel-box">
                  <div className="cockpit-channel-box-head">
                    <div className="cockpit-channel-title">
                      <span>🔑 AI Studio (本地统计)</span>
                    </div>
                    <div className="cockpit-channel-mini-actions">
                      <span
                        className="cockpit-key-pill"
                        title={`已关联 Key: ${ai.apiKey}\n点击修改或解绑`}
                        onClick={() => onEditAiStudioKey(group)}
                      >
                        {ai.apiKey.slice(0, 6)}...{ai.apiKey.slice(-4)}
                      </span>
                      <span className={`ag-quota-pct ${tones.text}`} style={{ fontSize: 12 }}>
                        {q?.dailyExhausted ? "已耗尽" : q?.inCooldown ? "冷却" : `${remPct}%`}
                      </span>
                      {onRemovePlatform && (
                        <button
                          type="button"
                          className="cockpit-icon-btn cockpit-icon-btn--danger"
                          style={{ width: 18, height: 18 }}
                          data-tip="解绑 AI Studio Key"
                          onClick={() => onRemovePlatform(group, "aiStudio")}
                        >
                          <IconTrash style={{ width: 10, height: 10 }} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="ag-quota-bar-track">
                    <div className={`ag-quota-bar-fill ${tones.bar}`} style={{ width: `${remPct}%` }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", flexWrap: "wrap", gap: 4 }}>
                    <span>今日请求: <strong style={{ color: "var(--text)" }}>{reqUsed}</strong>/{reqLimit} 次</span>
                    <span>Token: <strong style={{ color: "var(--text)" }}>{formatCompactTokens(tokUsed)}</strong>/{formatCompactTokens(tokLimit)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--muted)" }}>
                    <span>H:{q?.hydrogenUsedToday ?? 0}/{q?.hydrogenLimit ?? reqLimit} · Flash:{q?.flashUsedToday ?? 0}/{q?.flashLimit ?? reqLimit}</span>
                    <span>PT 00:00 重置</span>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="cockpit-channel-box cockpit-channel-box--empty">
              <span className="cockpit-channel-title" style={{ color: "var(--muted)" }}>🔑 AI Studio (本地)</span>
              <button
                type="button"
                className="cockpit-channel-add-btn"
                onClick={() => onEditAiStudioKey(group)}
              >
                + 关联 AI Studio Key
              </button>
            </div>
          )}

          {/* 3. ChatGPT + Grok Split Row */}
          <div className="cockpit-channel-split-grid">
            {/* ChatGPT */}
            {cg ? (
              (() => {
                const shortPct = cg.quota?.shortPercent ?? cg.quota?.fiveHourPercent;
                const shortRem = typeof shortPct === "number" ? Math.max(0, Math.min(100, Math.round(100 - shortPct))) : null;
                const weeklyRem = typeof cg.quota?.weeklyPercent === "number"
                  ? Math.max(0, Math.min(100, Math.round(100 - cg.quota.weeklyPercent)))
                  : null;
                const monthRem = Math.max(0, Math.min(100, Math.round(100 - (cg.quota?.monthlyPercent ?? 0))));
                const govRem = weeklyRem ?? monthRem;
                const tones = quotaToneClasses(govRem);
                const cgPlan = getPlanBadge(cg.plan);
                return (
                  <div className="cockpit-channel-box">
                    <div className="cockpit-channel-box-head">
                      <span className="cockpit-channel-title">
                        ⚡ ChatGPT
                        <span className={cgPlan.className} style={{ fontSize: 9.5, padding: "0 5px" }}>
                          {cgPlan.text}
                        </span>
                      </span>
                      <div className="cockpit-channel-mini-actions">
                        <button
                          type="button"
                          className={`cockpit-icon-btn ${cg.active ? "cockpit-icon-btn--active" : ""}`}
                          style={{ width: 20, height: 20 }}
                          data-tip={cg.active ? "当前 ChatGPT 账号" : "切换 ChatGPT 账号"}
                          disabled={switchingId === cg.id}
                          onClick={() => onSwitch(cg)}
                        >
                          <IconPlay style={{ width: 11, height: 11 }} />
                        </button>
                        <button
                          type="button"
                          className="cockpit-icon-btn"
                          style={{ width: 20, height: 20 }}
                          data-tip="刷新 ChatGPT 配额"
                          disabled={refreshingId === cg.id}
                          onClick={() => onRefresh(cg)}
                        >
                          <IconRefresh style={{ width: 11, height: 11 }} className={refreshingId === cg.id ? "spin" : ""} />
                        </button>
                        {onTogglePause && (
                          <button
                            type="button"
                            className={`cockpit-icon-btn ${cg.paused ? "cockpit-icon-btn--primary" : ""}`}
                            style={{ width: 20, height: 20 }}
                            data-tip={cg.paused ? "恢复 ChatGPT" : "暂停 ChatGPT"}
                            disabled={pausingId === cg.id}
                            onClick={() => onTogglePause(cg, !cg.paused)}
                          >
                            {pausingId === cg.id ? (
                              <IconRefresh style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />
                            ) : cg.paused ? (
                              <IconPower style={{ width: 11, height: 11, color: "#34d399" }} />
                            ) : (
                              <IconPause style={{ width: 11, height: 11 }} />
                            )}
                          </button>
                        )}
                        {onRemovePlatform && (
                          <button
                            type="button"
                            className="cockpit-icon-btn cockpit-icon-btn--danger"
                            style={{ width: 20, height: 20 }}
                            data-tip="移除 ChatGPT 授权"
                            onClick={() => onRemovePlatform(group, "chatgpt")}
                          >
                            <IconTrash style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11.5 }}>
                      <span style={{ color: "var(--muted)" }}>
                        {shortRem !== null ? `5h ${shortRem}%` : "5-Week"}
                      </span>
                      <span className={`ag-quota-pct ${tones.text}`}>{govRem}%</span>
                    </div>
                    <div className="ag-quota-bar-track">
                      <div className={`ag-quota-bar-fill ${tones.bar}`} style={{ width: `${govRem}%` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                      <span>{cg.paused ? "已暂停" : cg.active ? "当前使用" : "备用就绪"}</span>
                      {cg.quota?.monthlyResetAt && <span>{formatAntigravityReset(cg.quota.monthlyResetAt).split(" ")[0]}</span>}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="cockpit-channel-box cockpit-channel-box--empty" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                <span className="cockpit-channel-title" style={{ color: "var(--muted)" }}>⚡ ChatGPT</span>
                <button
                  type="button"
                  className="cockpit-channel-add-btn"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => onAddPlatform(group.email, "openai")}
                >
                  + 添加 ChatGPT
                </button>
              </div>
            )}

            {/* Grok */}
            {gk ? (
              (() => {
                const remainPct = Math.max(0, Math.min(100, Math.round(100 - (gk.quota?.weeklyPercent ?? 0))));
                const tones = quotaToneClasses(remainPct);
                const gkPlan = getPlanBadge(gk.plan);
                return (
                  <div className="cockpit-channel-box">
                    <div className="cockpit-channel-box-head">
                      <span className="cockpit-channel-title">
                        🤖 Grok
                        <span className={gkPlan.className} style={{ fontSize: 9.5, padding: "0 5px" }}>
                          {gkPlan.text}
                        </span>
                      </span>
                      <div className="cockpit-channel-mini-actions">
                        <button
                          type="button"
                          className={`cockpit-icon-btn ${gk.active ? "cockpit-icon-btn--active" : ""}`}
                          style={{ width: 20, height: 20 }}
                          data-tip={gk.active ? "当前 Grok 账号" : "切换 Grok 账号"}
                          disabled={switchingId === gk.id}
                          onClick={() => onSwitch(gk)}
                        >
                          <IconPlay style={{ width: 11, height: 11 }} />
                        </button>
                        <button
                          type="button"
                          className="cockpit-icon-btn"
                          style={{ width: 20, height: 20 }}
                          data-tip="刷新 Grok 配额"
                          disabled={refreshingId === gk.id}
                          onClick={() => onRefresh(gk)}
                        >
                          <IconRefresh style={{ width: 11, height: 11 }} className={refreshingId === gk.id ? "spin" : ""} />
                        </button>
                        {onTogglePause && (
                          <button
                            type="button"
                            className={`cockpit-icon-btn ${gk.paused ? "cockpit-icon-btn--primary" : ""}`}
                            style={{ width: 20, height: 20 }}
                            data-tip={gk.paused ? "恢复 Grok" : "暂停 Grok"}
                            disabled={pausingId === gk.id}
                            onClick={() => onTogglePause(gk, !gk.paused)}
                          >
                            {pausingId === gk.id ? (
                              <IconRefresh style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />
                            ) : gk.paused ? (
                              <IconPower style={{ width: 11, height: 11, color: "#34d399" }} />
                            ) : (
                              <IconPause style={{ width: 11, height: 11 }} />
                            )}
                          </button>
                        )}
                        {onRemovePlatform && (
                          <button
                            type="button"
                            className="cockpit-icon-btn cockpit-icon-btn--danger"
                            style={{ width: 20, height: 20 }}
                            data-tip="移除 Grok 授权"
                            onClick={() => onRemovePlatform(group, "grok")}
                          >
                            <IconTrash style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11.5 }}>
                      <span style={{ color: "var(--muted)" }}>Weekly</span>
                      <span className={`ag-quota-pct ${tones.text}`}>{remainPct}%</span>
                    </div>
                    <div className="ag-quota-bar-track">
                      <div className={`ag-quota-bar-fill ${tones.bar}`} style={{ width: `${remainPct}%` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                      <span>{gk.paused ? "已暂停" : gk.active ? "当前使用" : "正常"}</span>
                      {gk.quota?.weeklyResetAt && <span>{formatAntigravityReset(gk.quota.weeklyResetAt).split(" ")[0]}</span>}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="cockpit-channel-box cockpit-channel-box--empty" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                <span className="cockpit-channel-title" style={{ color: "var(--muted)" }}>🤖 Grok</span>
                <button
                  type="button"
                  className="cockpit-channel-add-btn"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => onAddPlatform(group.email, "xai")}
                >
                  + 添加 Grok
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Card Footer ── */}
      <div className="cockpit-card-foot">
        <span className="cockpit-card-date">
          {formatCockpitDate(group.updatedAt || group.createdAt)}
        </span>

        <div className="cockpit-card-actions">
          <button
            type="button"
            className="cockpit-icon-btn"
            data-tip="查看聚合账号详情"
            onClick={() => onShowInfo(group)}
          >
            <IconInfo style={{ width: 14, height: 14 }} />
          </button>
          {primaryOAuth && (
            <button
              type="button"
              className="cockpit-icon-btn"
              data-tip="加备注 / 别名"
              onClick={() => onEditAlias(primaryOAuth)}
            >
              <IconTag style={{ width: 14, height: 14 }} />
            </button>
          )}
          {(ag || gk) && onTestHealth && (
            <button
              type="button"
              className="cockpit-icon-btn"
              data-tip="真实模型调用健康检测"
              disabled={isTestingHealth}
              onClick={() => onTestHealth((ag ?? gk)!)}
            >
              <IconActivity
                style={{ width: 14, height: 14, color: isTestingHealth ? "#f59e0b" : "#38bdf8" }}
                className={isTestingHealth ? "spin" : ""}
              />
            </button>
          )}
          {primaryOAuth && onTogglePause && (
            <button
              type="button"
              className={`cockpit-icon-btn ${primaryOAuth.paused ? "cockpit-icon-btn--primary" : ""}`}
              data-tip={primaryOAuth.paused ? "恢复启用" : "停用此账号"}
              disabled={pausingId === primaryOAuth.id}
              onClick={() => onTogglePause(primaryOAuth, !primaryOAuth.paused)}
            >
              {pausingId === primaryOAuth.id ? (
                <IconRefresh style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
              ) : primaryOAuth.paused ? (
                <IconPower style={{ width: 14, height: 14, color: "#34d399" }} />
              ) : (
                <IconPause style={{ width: 14, height: 14 }} />
              )}
            </button>
          )}
          <button
            type="button"
            className="cockpit-icon-btn"
            data-tip={isCopied ? "已复制" : "复制邮箱"}
            onClick={() => onCopy(group.email, group.emailKey)}
          >
            {isCopied ? (
              <IconCheck style={{ width: 14, height: 14, color: "#10b981" }} />
            ) : (
              <IconCopy style={{ width: 14, height: 14 }} />
            )}
          </button>
          <button
            type="button"
            className="cockpit-icon-btn"
            data-tip="刷新该邮箱全部渠道配额"
            disabled={isRefreshingGroup}
            onClick={() => onRefreshGroup(group)}
          >
            <IconRefresh style={{ width: 14, height: 14 }} className={isRefreshingGroup ? "spin" : ""} />
          </button>
          <button
            type="button"
            className="cockpit-icon-btn"
            data-tip="导出邮箱聚合配置"
            onClick={() => onExport(group)}
          >
            <IconUpload style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            className="cockpit-icon-btn cockpit-icon-btn--danger"
            data-tip="移除此邮箱下账号"
            onClick={() => onRemoveGroup(group)}
          >
            <IconTrash style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>
    </div>
  );
};
