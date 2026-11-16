import React from "react";
import { type EmailAccountGroup, type UnifiedAccountItem } from "../../types/account";
import { formatCockpitDate } from "./CockpitAccountCard";
import { formatCompactTokens, quotaToneClasses } from "./email-account-groups";
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
  groups: EmailAccountGroup[];
  selectedIds: Set<string>;
  switchingId: string | null;
  refreshingId: string | null;
  isCopiedKey?: (emailKey: string) => boolean;
  testingHealthIds?: Set<string>;
  isTestingAll?: boolean;
  pausingId?: string | null;
  isBatchPausing?: boolean;
  formatEmail: (email: string) => string;
  onToggleSelectAll: () => void;
  onToggleSelectOne: (emailKey: string) => void;
  onSwitch: (item: UnifiedAccountItem) => void;
  onRefresh: (item: UnifiedAccountItem) => void;
  onRefreshGroup: (group: EmailAccountGroup) => void;
  onTogglePause?: (item: UnifiedAccountItem, paused: boolean) => void;
  onPauseAllUnusable?: () => void;
  onTestHealth?: (item: UnifiedAccountItem) => void;
  onTestAllHealth?: () => void;
  onEditAlias: (item: UnifiedAccountItem) => void;
  onEditAiStudioKey: (group: EmailAccountGroup) => void;
  onAddPlatform: (email: string, provider: "google-antigravity" | "openai" | "xai") => void;
  onCopy: (text: string, id: string) => void;
  onRemoveGroup: (group: EmailAccountGroup) => void;
}

function getPlanBadgeClass(plan?: string | null): string {
  const p = (plan ?? "").toLowerCase();
  if (p.includes("ultra")) return "cockpit-badge-plan cockpit-badge-plan--ultra";
  if (p.includes("pro") || p === "g1-pro-tier") return "cockpit-badge-plan";
  if (p.includes("plus")) return "cockpit-badge-plan cockpit-badge-plan--plus";
  return "cockpit-badge-plan cockpit-badge-plan--free";
}

function getPlanText(plan?: string | null): string {
  const p = (plan ?? "").toLowerCase();
  if (p.includes("ultra")) return "ULTRA";
  if (p.includes("pro") || p === "g1-pro-tier") return "PRO";
  if (p.includes("plus")) return "PLUS";
  if (p.includes("free")) return "FREE";
  return (plan || "FREE").toUpperCase();
}

export const CockpitHealthTable: React.FC<CockpitHealthTableProps> = ({
  groups,
  selectedIds,
  switchingId,
  refreshingId,
  isCopiedKey,
  testingHealthIds = new Set(),
  isTestingAll = false,
  pausingId = null,
  isBatchPausing = false,
  formatEmail,
  onToggleSelectAll,
  onToggleSelectOne,
  onSwitch,
  onRefresh,
  onRefreshGroup,
  onTogglePause,
  onPauseAllUnusable,
  onTestHealth,
  onTestAllHealth,
  onEditAlias,
  onEditAiStudioKey,
  onAddPlatform,
  onCopy,
  onRemoveGroup,
}) => {
  const isAllSelected = groups.length > 0 && selectedIds.size === groups.length;
  const unusableCount = groups.filter(g => g.anyUnusable).length;

  return (
    <div className="cockpit-table-wrap">
      {onTestAllHealth && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
            background: "rgba(255,255,255,0.02)",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            共 <strong>{groups.length}</strong> 个邮箱账号 · 同屏合并显示 Antigravity / AI Studio（本地统计）/ ChatGPT / Grok 四大额度
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
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                borderRadius: 6,
                padding: "3px 10px",
                background: "rgba(56, 189, 248, 0.08)",
              }}
              disabled={isTestingAll}
              onClick={onTestAllHealth}
              data-tip="并发向上游发起真实模型 Prompt 探测，测试所有账号可用性"
            >
              <IconActivity style={{ width: 14, height: 14 }} className={isTestingAll ? "spin" : ""} />
              <span>{isTestingAll ? "正在批量测试健康..." : "一键真实模型检测 (全部邮箱)"}</span>
            </button>
          </div>
        </div>
      )}

      <table className="cockpit-table">
        <thead>
          <tr>
            <th style={{ width: 38 }}>
              <input
                type="checkbox"
                className="cockpit-checkbox"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
              />
            </th>
            <th>账号邮箱 / 状态</th>
            <th>🌐 Antigravity 额度</th>
            <th>🔑 AI Studio 额度 (本地统计)</th>
            <th>⚡ ChatGPT 额度</th>
            <th>🤖 Grok 额度</th>
            <th>更新时间</th>
            <th style={{ textAlign: "right" }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => {
            const ag = group.antigravity;
            const ai = group.aiStudio;
            const cg = group.chatgpt;
            const gk = group.grok;
            const primaryOAuth = ag ?? gk ?? cg;
            const isCopied = Boolean(isCopiedKey?.(group.emailKey));
            const isTestingHealth = Boolean(
              (ag && testingHealthIds.has(ag.id)) || (gk && testingHealthIds.has(gk.id)),
            );
            const isRefreshingGroup = Boolean(
              (ag && refreshingId === ag.id) || (cg && refreshingId === cg.id) || (gk && refreshingId === gk.id),
            );

            // Antigravity derived windows
            const agWindows = ag?.quota?.customWindows ?? [];
            const findAgWin = (prefix: string, isWeekly: boolean) =>
              agWindows.find(w => {
                const l = w.label.toLowerCase();
                return (l.startsWith(prefix) || l.includes(prefix)) && (isWeekly ? l.includes("week") : !l.includes("week"));
              });
            const agRem = (w?: (typeof agWindows)[0]) =>
              w ? Math.max(0, Math.min(100, Math.round(100 - (typeof w.percent === "number" ? w.percent : 0)))) : 100;
            const claRem = findAgWin("cla", true) ? agRem(findAgWin("cla", true)) : null;
            const gemRem = findAgWin("gem", true) ? agRem(findAgWin("gem", true)) : null;
            const argonRem = group.hasArgon && findAgWin("argon", true) ? agRem(findAgWin("argon", true)) : null;
            const agMinRem = [claRem, gemRem, argonRem].filter((v): v is number => v !== null);
            const agBarPct = agMinRem.length > 0 ? Math.min(...agMinRem) : 100;
            const agTones = quotaToneClasses(agBarPct);

            return (
              <tr
                key={group.emailKey}
                style={{
                  opacity: group.allPaused ? 0.62 : 1,
                  background: group.allPaused
                    ? "rgba(0,0,0,0.08)"
                    : group.anyUnusable
                      ? "rgba(239, 68, 68, 0.04)"
                      : undefined,
                }}
              >
                <td>
                  <input
                    type="checkbox"
                    className="cockpit-checkbox"
                    checked={selectedIds.has(group.emailKey)}
                    onChange={() => onToggleSelectOne(group.emailKey)}
                  />
                </td>

                {/* Email & Overall Health / Status */}
                <td style={{ minWidth: 195 }}>
                  <div style={{ fontWeight: 700, wordBreak: "break-all" }}>{formatEmail(group.email)}</div>
                  {group.alias && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{group.alias}</div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                    {group.anyActive && <span className="cockpit-badge-active" style={{ fontSize: 10, padding: "1px 6px" }}>使用中</span>}
                    {group.allPaused ? (
                      <span
                        className="badge"
                        style={{
                          background: "rgba(239, 68, 68, 0.14)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          fontSize: 10,
                          padding: "1px 6px",
                        }}
                      >
                        ● 已停用
                      </span>
                    ) : group.anyUnusable ? (
                      <span
                        className="badge"
                        style={{
                          background: "rgba(239, 68, 68, 0.14)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          fontSize: 10,
                          padding: "1px 6px",
                        }}
                      >
                        ⚠️ 状态异常
                      </span>
                    ) : !group.anyActive ? (
                      <span style={{ color: "#10b981", fontSize: 11, fontWeight: 600 }}>● 就绪</span>
                    ) : null}
                  </div>
                </td>

                {/* Column 1: Antigravity */}
                <td>
                  {ag ? (
                    <div className="cockpit-table-cell-col" style={{ minWidth: 175 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <span className={getPlanBadgeClass(ag.plan)} style={{ fontSize: 10, padding: "1px 6px" }}>
                            {getPlanText(ag.plan)}
                          </span>
                          <span
                            className="badge"
                            style={{
                              background: group.hasArgon ? "rgba(168, 85, 247, 0.14)" : "rgba(59, 130, 246, 0.14)",
                              color: group.hasArgon ? "#a855f7" : "#3b82f6",
                              border: `1px solid ${group.hasArgon ? "rgba(168, 85, 247, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                              fontSize: 10,
                              padding: "1px 5px",
                            }}
                            title={group.hasArgon ? "支持 Gemini 4 Argon + Hydrogen + Claude 5.5" : "支持 Hydrogen + Flash + Claude 4.6"}
                          >
                            {group.hasArgon ? "🌟 Argon" : "⚡ Flash"}
                          </span>
                          {ag.healthTest && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: ag.healthTest.ok ? "#10b981" : "#f87171",
                              }}
                              title={ag.healthTest.message}
                            >
                              {ag.healthTest.ok ? "200" : ag.healthTest.status}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={`cockpit-icon-btn ${ag.active ? "cockpit-icon-btn--active" : ""}`}
                          style={{ width: 22, height: 22 }}
                          data-tip={ag.active ? "Antigravity 当前账号" : "切换 Antigravity 到此账号"}
                          disabled={switchingId === ag.id}
                          onClick={() => onSwitch(ag)}
                        >
                          <IconPlay style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                      <div className="cockpit-table-cell-metrics">
                        <span>Cla周: <strong className={claRem !== null ? quotaToneClasses(claRem).text : ""}>{claRem ?? 100}%</strong></span>
                        <span>Gem周: <strong className={gemRem !== null ? quotaToneClasses(gemRem).text : ""}>{gemRem ?? 100}%</strong></span>
                        {argonRem !== null && (
                          <span>Argon: <strong className={quotaToneClasses(argonRem).text}>{argonRem}%</strong></span>
                        )}
                      </div>
                      <div className="cockpit-mini-bar-track">
                        <div className={`cockpit-mini-bar-fill ${agTones.bar}`} style={{ width: `${agBarPct}%` }} />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cockpit-channel-add-btn"
                      data-tip={`为 ${group.email} 登录添加 Google Antigravity`}
                      onClick={() => onAddPlatform(group.email, "google-antigravity")}
                    >
                      + 添加 Antigravity
                    </button>
                  )}
                </td>

                {/* Column 2: AI Studio (Local Statistics) */}
                <td>
                  {ai ? (
                    <div className="cockpit-table-cell-col" style={{ minWidth: 168 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <span
                          className="cockpit-key-pill"
                          title={`点击修改或解绑 AI Studio Key (${ai.apiKey})\n今日 Hydrogen: ${ai.quota?.hydrogenUsedToday ?? 0}/${ai.quota?.hydrogenLimit ?? 50}\n今日 Flash: ${ai.quota?.flashUsedToday ?? 0}/${ai.quota?.flashLimit ?? 50}`}
                          onClick={() => onEditAiStudioKey(group)}
                        >
                          <span>🔑</span>
                          <span>{ai.apiKey.slice(0, 6)}...{ai.apiKey.slice(-4)}</span>
                        </span>
                        <span
                          className={`ag-quota-pct ${quotaToneClasses(ai.quota?.remainingPercent ?? 100).text}`}
                          style={{ fontSize: 11.5 }}
                        >
                          {ai.quota?.dailyExhausted ? "已耗尽" : ai.quota?.inCooldown ? "冷却中" : `${ai.quota?.remainingPercent ?? 100}%`}
                        </span>
                      </div>
                      <div className="cockpit-table-cell-metrics">
                        <span>
                          今日: <strong>{ai.quota?.requestsToday ?? 0}</strong>/{ai.quota?.dailyRequestLimit ?? 50}次
                        </span>
                        <span>
                          Tok: <strong>{formatCompactTokens(ai.quota?.tokensToday ?? 0)}</strong>/{formatCompactTokens(ai.quota?.dailyTokenLimit ?? 10_000_000)}
                        </span>
                      </div>
                      <div className="cockpit-mini-bar-track">
                        <div
                          className={`cockpit-mini-bar-fill ${quotaToneClasses(ai.quota?.remainingPercent ?? 100).bar}`}
                          style={{ width: `${ai.quota?.remainingPercent ?? 100}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cockpit-channel-add-btn"
                      data-tip={`为 ${group.email} 关联 Google AI Studio API Key`}
                      onClick={() => onEditAiStudioKey(group)}
                    >
                      + 关联 AI Studio Key
                    </button>
                  )}
                </td>

                {/* Column 3: ChatGPT / Codex */}
                <td>
                  {cg ? (
                    (() => {
                      const shortPct = cg.quota?.shortPercent ?? cg.quota?.fiveHourPercent;
                      const shortRem = typeof shortPct === "number" ? Math.max(0, Math.min(100, Math.round(100 - shortPct))) : null;
                      const weeklyRem = typeof cg.quota?.weeklyPercent === "number"
                        ? Math.max(0, Math.min(100, Math.round(100 - cg.quota.weeklyPercent)))
                        : null;
                      const monthRem = typeof cg.quota?.monthlyPercent === "number"
                        ? Math.max(0, Math.min(100, Math.round(100 - cg.quota.monthlyPercent)))
                        : 100;
                      const govRem = weeklyRem ?? monthRem;
                      const cgTones = quotaToneClasses(govRem);
                      return (
                        <div className="cockpit-table-cell-col" style={{ minWidth: 145 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span className={getPlanBadgeClass(cg.plan)} style={{ fontSize: 10, padding: "1px 6px" }}>
                                {getPlanText(cg.plan)}
                              </span>
                              {cg.paused && (
                                <span style={{ fontSize: 10, color: "#f87171", fontWeight: 600 }}>已暂停</span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                              <button
                                type="button"
                                className={`cockpit-icon-btn ${cg.active ? "cockpit-icon-btn--active" : ""}`}
                                style={{ width: 22, height: 22 }}
                                data-tip={cg.active ? "ChatGPT 当前账号" : "切换 ChatGPT 到此账号"}
                                disabled={switchingId === cg.id}
                                onClick={() => onSwitch(cg)}
                              >
                                <IconPlay style={{ width: 12, height: 12 }} />
                              </button>
                              <button
                                type="button"
                                className="cockpit-icon-btn"
                                style={{ width: 22, height: 22 }}
                                data-tip="刷新 ChatGPT 配额"
                                disabled={refreshingId === cg.id}
                                onClick={() => onRefresh(cg)}
                              >
                                <IconRefresh style={{ width: 12, height: 12 }} className={refreshingId === cg.id ? "spin" : ""} />
                              </button>
                            </div>
                          </div>
                          <div className="cockpit-table-cell-metrics">
                            {shortRem !== null && (
                              <span>5h: <strong className={quotaToneClasses(shortRem).text}>{shortRem}%</strong></span>
                            )}
                            {weeklyRem !== null ? (
                              <span>周: <strong className={quotaToneClasses(weeklyRem).text}>{weeklyRem}%</strong></span>
                            ) : (
                              <span>5W: <strong className={cgTones.text}>{monthRem}%</strong></span>
                            )}
                          </div>
                          <div className="cockpit-mini-bar-track">
                            <div className={`cockpit-mini-bar-fill ${cgTones.bar}`} style={{ width: `${govRem}%` }} />
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <button
                      type="button"
                      className="cockpit-channel-add-btn"
                      data-tip={`为 ${group.email} 添加 ChatGPT / Codex 账号`}
                      onClick={() => onAddPlatform(group.email, "openai")}
                    >
                      + 添加 ChatGPT
                    </button>
                  )}
                </td>

                {/* Column 4: xAI Grok */}
                <td>
                  {gk ? (
                    (() => {
                      const remainPct = Math.max(0, Math.min(100, Math.round(100 - (gk.quota?.weeklyPercent ?? 0))));
                      const gkTones = quotaToneClasses(remainPct);
                      return (
                        <div className="cockpit-table-cell-col" style={{ minWidth: 135 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <span className={getPlanBadgeClass(gk.plan)} style={{ fontSize: 10, padding: "1px 6px" }}>
                              {getPlanText(gk.plan)}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                              <button
                                type="button"
                                className={`cockpit-icon-btn ${gk.active ? "cockpit-icon-btn--active" : ""}`}
                                style={{ width: 22, height: 22 }}
                                data-tip={gk.active ? "Grok 当前账号" : "切换 Grok 到此账号"}
                                disabled={switchingId === gk.id}
                                onClick={() => onSwitch(gk)}
                              >
                                <IconPlay style={{ width: 12, height: 12 }} />
                              </button>
                              <button
                                type="button"
                                className="cockpit-icon-btn"
                                style={{ width: 22, height: 22 }}
                                data-tip="刷新 Grok 配额"
                                disabled={refreshingId === gk.id}
                                onClick={() => onRefresh(gk)}
                              >
                                <IconRefresh style={{ width: 12, height: 12 }} className={refreshingId === gk.id ? "spin" : ""} />
                              </button>
                            </div>
                          </div>
                          <div className="cockpit-table-cell-metrics">
                            <span>周剩余: <strong className={gkTones.text}>{remainPct}%</strong></span>
                          </div>
                          <div className="cockpit-mini-bar-track">
                            <div className={`cockpit-mini-bar-fill ${gkTones.bar}`} style={{ width: `${remainPct}%` }} />
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <button
                      type="button"
                      className="cockpit-channel-add-btn"
                      data-tip={`为 ${group.email} 授权添加 xAI Grok`}
                      onClick={() => onAddPlatform(group.email, "xai")}
                    >
                      + 添加 Grok
                    </button>
                  )}
                </td>

                <td style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {formatCockpitDate(group.updatedAt)}
                </td>

                {/* Group Row Actions */}
                <td style={{ textAlign: "right" }}>
                  <div className="cockpit-card-actions" style={{ justifyContent: "flex-end" }}>
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
                        data-tip={primaryOAuth.paused ? "恢复启用账号" : "停用账号"}
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
                      data-tip="刷新该邮箱全部已开通额度"
                      disabled={isRefreshingGroup}
                      onClick={() => onRefreshGroup(group)}
                    >
                      <IconRefresh style={{ width: 14, height: 14 }} className={isRefreshingGroup ? "spin" : ""} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      data-tip={ai ? "修改/解绑 AI Studio Key" : "关联 AI Studio Key"}
                      onClick={() => onEditAiStudioKey(group)}
                    >
                      <span style={{ fontSize: 13 }}>🔑</span>
                    </button>
                    {primaryOAuth && (
                      <button
                        type="button"
                        className="cockpit-icon-btn"
                        data-tip="修改备注别名"
                        onClick={() => onEditAlias(primaryOAuth)}
                      >
                        <IconPencil style={{ width: 14, height: 14 }} />
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
                      className="cockpit-icon-btn cockpit-icon-btn--danger"
                      data-tip="移除此邮箱下的账号配置"
                      onClick={() => onRemoveGroup(group)}
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
