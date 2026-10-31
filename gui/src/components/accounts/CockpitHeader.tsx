import React, { useRef, useState, useEffect } from "react";
import { IconUser } from "../../icons";

interface CockpitHeaderProps {
  totalCount: number;
  antigravityCount: number;
  openaiCount: number;
  selectedProvider: string;
  activeTab: "overview" | "instances" | "tasks" | "health";
  onSelectProvider: (provider: string) => void;
  onSelectTab: (tab: "overview" | "instances" | "tasks" | "health") => void;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  totalCount,
  antigravityCount,
  openaiCount,
  selectedProvider,
  activeTab,
  onSelectProvider,
  onSelectTab,
}) => {
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProviderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const providerLabel = selectedProvider === "google-antigravity"
    ? `Antigravity IDE (${antigravityCount})`
    : selectedProvider === "openai"
      ? `OpenAI / Codex (${openaiCount})`
      : `全部提供方 (${totalCount})`;

  return (
    <div className="cockpit-top-bar">
      {/* ── Top Row: Title, Announcement Banner, Version Tag ── */}
      <div className="cockpit-header-top-row">
        <div className="cockpit-title-group">
          <h1 className="cockpit-page-title">
            <IconUser style={{ width: 22, height: 22 }} />
            账号
          </h1>
          <span
            className="cockpit-info-badge"
            title="Cockpit 风格集中管理 Google Antigravity、OpenAI 与各提供商账号配额"
          >
            ?
          </span>
        </div>

        {/* Announcement / Tip Banner */}
        <div className="cockpit-banner-pill">
          <span className="cockpit-banner-tag">推广</span>
          <span className="cockpit-banner-text">
            GPT Plus 30天成品号 | 各套餐实付代充 可续费 需要的了解下 感谢支持
          </span>
          <a
            href="https://github.com/vanch/opencodex"
            target="_blank"
            rel="noreferrer"
            className="cockpit-banner-action"
          >
            选购
          </a>
        </div>

        {/* Version & Status Tag */}
        <div className="cockpit-version-tag">
          <span className="cockpit-status-dot" />
          <span>OpenCodex v2.95.0</span>
        </div>
      </div>

      {/* ── Second Row: Provider Selector Dropdown & Centered Navigation Pills ── */}
      <div className="cockpit-nav-row">
        {/* Provider Dropdown */}
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            type="button"
            className="cockpit-provider-dropdown-btn"
            onClick={() => setProviderMenuOpen(!providerMenuOpen)}
          >
            <span style={{ fontSize: 14 }}>🚀</span>
            <span>{providerLabel}</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>⌄</span>
          </button>

          {providerMenuOpen && (
            <div className="cockpit-dropdown-menu">
              <button
                type="button"
                className={`cockpit-dropdown-item${selectedProvider === "all" ? " active" : ""}`}
                onClick={() => {
                  onSelectProvider("all");
                  setProviderMenuOpen(false);
                }}
              >
                <span>全部提供方</span>
                <span className="cockpit-provider-tab-badge">{totalCount}</span>
              </button>
              <button
                type="button"
                className={`cockpit-dropdown-item${selectedProvider === "google-antigravity" ? " active" : ""}`}
                onClick={() => {
                  onSelectProvider("google-antigravity");
                  setProviderMenuOpen(false);
                }}
              >
                <span>Google Antigravity</span>
                <span className="cockpit-provider-tab-badge">{antigravityCount}</span>
              </button>
              <button
                type="button"
                className={`cockpit-dropdown-item${selectedProvider === "openai" ? " active" : ""}`}
                onClick={() => {
                  onSelectProvider("openai");
                  setProviderMenuOpen(false);
                }}
              >
                <span>OpenAI / Codex</span>
                <span className="cockpit-provider-tab-badge">{openaiCount}</span>
              </button>
            </div>
          )}
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
