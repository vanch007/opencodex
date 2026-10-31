import React from "react";
import { IconUser } from "../../icons";

interface CockpitHeaderProps {
  totalCount: number;
  antigravityCount: number;
  openaiCount: number;
  grokCount: number;
  selectedProvider: string;
  activeTab: "overview" | "instances" | "tasks" | "health";
  onSelectProvider: (provider: string) => void;
  onSelectTab: (tab: "overview" | "instances" | "tasks" | "health") => void;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  totalCount,
  antigravityCount,
  openaiCount,
  grokCount,
  selectedProvider,
  activeTab,
  onSelectProvider,
  onSelectTab,
}) => {
  return (
    <div className="cockpit-top-bar">
      {/* ── Top Row: Title & Version Tag ── */}
      <div className="cockpit-header-top-row">
        <div className="cockpit-title-group">
          <h1 className="cockpit-page-title">
            <IconUser style={{ width: 22, height: 22 }} />
            账号
          </h1>
          <span
            className="cockpit-info-badge"
            title="Cockpit 风格集中管理 Google Antigravity、OpenAI、xAI Grok 与各提供商账号配额"
          >
            ?
          </span>
        </div>

        {/* Version & Status Tag */}
        <div className="cockpit-version-tag">
          <span className="cockpit-status-dot" />
          <span>OpenCodex v2.95.0</span>
        </div>
      </div>

      {/* ── Second Row: Provider Selection Tabs & Centered Navigation Pills ── */}
      <div className="cockpit-nav-row">
        {/* Provider Tabs (Replaces Dropdown Menu) */}
        <div className="cockpit-provider-tabs">
          <button
            type="button"
            className={`cockpit-provider-tab${selectedProvider === "all" ? " active" : ""}`}
            onClick={() => onSelectProvider("all")}
          >
            <span style={{ fontSize: 13 }}>🚀</span>
            <span>全部提供方</span>
            <span className="cockpit-provider-tab-badge">{totalCount}</span>
          </button>
          <button
            type="button"
            className={`cockpit-provider-tab${selectedProvider === "google-antigravity" ? " active" : ""}`}
            onClick={() => onSelectProvider("google-antigravity")}
          >
            <span style={{ fontSize: 13 }}>🌐</span>
            <span>Google Antigravity</span>
            <span className="cockpit-provider-tab-badge">{antigravityCount}</span>
          </button>
          <button
            type="button"
            className={`cockpit-provider-tab${selectedProvider === "openai" ? " active" : ""}`}
            onClick={() => onSelectProvider("openai")}
          >
            <span style={{ fontSize: 13 }}>⚡</span>
            <span>OpenAI / Codex</span>
            <span className="cockpit-provider-tab-badge">{openaiCount}</span>
          </button>
          <button
            type="button"
            className={`cockpit-provider-tab${selectedProvider === "xai" ? " active" : ""}`}
            onClick={() => onSelectProvider("xai")}
          >
            <span style={{ fontSize: 13 }}>🤖</span>
            <span>xAI Grok</span>
            <span className="cockpit-provider-tab-badge">{grokCount}</span>
          </button>
        </div>

        {/* Centered Navigation Tabs */}
        <div className="cockpit-nav-pills">
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "overview" ? " active" : ""}`}
            onClick={() => onSelectTab("overview")}
          >
            <span style={{ fontSize: 13 }}>🚀</span>
            <span>账号总览</span>
          </button>
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "instances" ? " active" : ""}`}
            onClick={() => onSelectTab("instances")}
          >
            <span style={{ fontSize: 13 }}>🗂</span>
            <span>多开实例</span>
          </button>
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "tasks" ? " active" : ""}`}
            onClick={() => onSelectTab("tasks")}
          >
            <span style={{ fontSize: 13 }}>⏰</span>
            <span>唤醒任务</span>
          </button>
          <button
            type="button"
            className={`cockpit-nav-pill${activeTab === "health" ? " active" : ""}`}
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
