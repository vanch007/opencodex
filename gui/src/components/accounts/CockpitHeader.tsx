import React from "react";
import { IconUser } from "../../icons";

interface CockpitHeaderProps {
  emailCount: number;
  antigravityCount: number;
  aiStudioCount: number;
  chatgptCount: number;
  grokCount: number;
  activeTab: "overview" | "instances" | "tasks" | "health";
  onSelectTab: (tab: "overview" | "instances" | "tasks" | "health") => void;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  emailCount,
  antigravityCount,
  aiStudioCount,
  chatgptCount,
  grokCount,
  activeTab,
  onSelectTab,
}) => {
  return (
    <div className="cockpit-top-bar">
      {/* ── Top Row: Title & Version Tag ── */}
      <div className="cockpit-header-top-row">
        <div className="cockpit-title-group">
          <h1 className="cockpit-page-title">
            <IconUser style={{ width: 22, height: 22 }} />
            邮箱账号总览
          </h1>
          <span
            className="cockpit-info-badge"
            title="按邮箱合并展示 Google Antigravity、AI Studio（本地统计）、ChatGPT 与 xAI Grok 四大渠道额度，未开通渠道可直接在对应邮箱上添加"
          >
            ?
          </span>
        </div>

        <div className="cockpit-version-tag">
          <span className="cockpit-status-dot" />
          <span>OpenCodex v2.100.0</span>
        </div>
      </div>

      {/* ── Second Row: Single Unified Email Tab & Coverage Badges + Navigation Pills ── */}
      <div className="cockpit-nav-row">
        <div className="cockpit-provider-tabs">
          <div
            className="cockpit-provider-tab active"
            data-tip="按邮箱聚合管理 Antigravity、AI Studio、ChatGPT 与 Grok 额度"
            style={{ cursor: "default" }}
          >
            <span style={{ fontSize: 13 }}>📧</span>
            <span>全部邮箱账号</span>
            <span className="cockpit-provider-tab-badge">{emailCount}</span>
          </div>
          <span className="cockpit-channel-stat-chip" data-tip="已登录 Google Antigravity 的邮箱数">
            🌐 Antigravity <strong>{antigravityCount}</strong>
          </span>
          <span className="cockpit-channel-stat-chip" data-tip="已关联 Google AI Studio API Key 的邮箱数">
            🔑 AI Studio <strong>{aiStudioCount}</strong>
          </span>
          <span className="cockpit-channel-stat-chip" data-tip="已接入 ChatGPT / Codex 的邮箱数">
            ⚡ ChatGPT <strong>{chatgptCount}</strong>
          </span>
          <span className="cockpit-channel-stat-chip" data-tip="已授权 xAI Grok 的邮箱数">
            🤖 Grok <strong>{grokCount}</strong>
          </span>
        </div>

        {/* Navigation Pills */}
        <div className="cockpit-nav-pills">
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "overview" ? " active" : ""}`}
            data-tip="按邮箱聚合的配额卡片与列表总览"
            onClick={() => onSelectTab("overview")}
          >
            <span style={{ fontSize: 13 }}>🚀</span>
            <span>账号总览</span>
          </button>
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "instances" ? " active" : ""}`}
            data-tip="查看本地代理实例信息"
            onClick={() => onSelectTab("instances")}
          >
            <span style={{ fontSize: 13 }}>🗂</span>
            <span>多开实例</span>
          </button>
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "tasks" ? " active" : ""}`}
            data-tip="查看自动配额刷新与唤醒计划"
            onClick={() => onSelectTab("tasks")}
          >
            <span style={{ fontSize: 13 }}>⏰</span>
            <span>唤醒任务</span>
          </button>
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "health" ? " active" : ""}`}
            data-tip="表格视图：四渠道额度同屏对比与真实模型健康检测"
            onClick={() => onSelectTab("health")}
          >
            <span style={{ fontSize: 13 }}>🛡</span>
            <span>账户检测</span>
          </button>
        </div>
      </div>
    </div>
  );
};
