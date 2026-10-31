import { type AccountQuota } from "../../codex-quota-utils";

interface AntigravityQuotaCardProps {
  quota?: AccountQuota | null;
  pending?: boolean;
}

/**
 * Format remaining time countdown and target reset date string.
 * Example output: "4h 59m (10/31 17:41)" or "6d 11h 22m (11/07 00:01)"
 */
export function formatAntigravityReset(resetAt?: number): string {
  if (!resetAt || !Number.isFinite(resetAt)) return "";
  const ms = resetAt < 10_000_000_000 ? resetAt * 1000 : resetAt;
  const now = Date.now();
  const diffMs = Math.max(0, ms - now);

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  let durationStr = "";
  if (days > 0) {
    durationStr = `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    durationStr = `${hours}h ${minutes}m`;
  } else {
    durationStr = `${minutes}m`;
  }

  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const dateStr = `${month}/${day} ${hh}:${mm}`;

  return `${durationStr} (${dateStr})`;
}

/** Check if this quota object is Antigravity quota */
export function isAntigravityQuota(quota?: unknown): boolean {
  if (!quota || typeof quota !== "object") return false;
  const q = (quota as { quota?: unknown }).quota ?? quota;
  const customWindows = (q as { customWindows?: unknown }).customWindows;
  if (!Array.isArray(customWindows)) return false;
  return customWindows.some((w: unknown) => {
    if (!w || typeof w !== "object") return false;
    const label = (w as { label?: string }).label;
    if (typeof label !== "string") return false;
    const l = label.toLowerCase();
    return l.startsWith("gem") || l.startsWith("cla") || l.startsWith("argon");
  });
}

interface WindowView {
  label: string;
  remainingPercent: number;
  resetText: string;
}

function renderQuotaWindow(w: WindowView) {
  const { label, remainingPercent, resetText } = w;
  const toneClass = remainingPercent < 20
    ? "ag-quota-pct--danger"
    : remainingPercent < 50
      ? "ag-quota-pct--warn"
      : "ag-quota-pct--healthy";

  const barToneClass = remainingPercent < 20
    ? "ag-quota-bar-fill--danger"
    : remainingPercent < 50
      ? "ag-quota-bar-fill--warn"
      : "ag-quota-bar-fill--healthy";

  return (
    <div className="ag-quota-window" key={label}>
      <div className="ag-quota-head">
        <span className="ag-quota-label">{label}</span>
        <span className={`ag-quota-pct ${toneClass}`}>{remainingPercent}%</span>
      </div>
      <div className="ag-quota-bar-track">
        <div
          className={`ag-quota-bar-fill ${barToneClass}`}
          style={{ width: `${Math.max(0, Math.min(100, remainingPercent))}%` }}
        />
      </div>
      {resetText && <div className="ag-quota-reset" title={resetText}>{resetText}</div>}
    </div>
  );
}

export function AntigravityQuotaCard({ quota, pending }: AntigravityQuotaCardProps) {
  if (pending && !quota) {
    return (
      <div className="ag-quota-card ag-quota-card--pending" aria-busy="true">
        <div className="ag-quota-grid">
          <div className="ag-quota-col">
            <div className="ag-quota-col-title">Claude</div>
            <div className="ag-quota-window">
              <div className="quota-skel" style={{ height: 16, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 6, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 12, width: "60%" }} />
            </div>
            <div className="ag-quota-window">
              <div className="quota-skel" style={{ height: 16, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 6, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 12, width: "60%" }} />
            </div>
          </div>
          <div className="ag-quota-col">
            <div className="ag-quota-col-title">Gemini</div>
            <div className="ag-quota-window">
              <div className="quota-skel" style={{ height: 16, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 6, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 12, width: "60%" }} />
            </div>
            <div className="ag-quota-window">
              <div className="quota-skel" style={{ height: 16, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 6, width: "100%", marginBottom: 6 }} />
              <div className="quota-skel" style={{ height: 12, width: "60%" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const windows = quota?.customWindows ?? [];

  const findWindow = (prefixes: string[], isWeekly: boolean) => {
    return windows.find(w => {
      const l = w.label.toLowerCase();
      const matchesPrefix = prefixes.some(p => l.startsWith(p.toLowerCase()) || l.includes(p.toLowerCase()));
      const weekly = l.includes("week");
      return matchesPrefix && (isWeekly ? weekly : !weekly);
    });
  };

  // Claude windows
  const cla5hRaw = findWindow(["Cla", "Claude"], false);
  const claWeeklyRaw = findWindow(["Cla", "Claude"], true);

  // Gemini windows
  const gem5hRaw = findWindow(["Gem", "Gemini"], false);
  const gemWeeklyRaw = findWindow(["Gem", "Gemini"], true);

  // Argon windows (optional)
  const argon5hRaw = findWindow(["Argon"], false);
  const argonWeeklyRaw = findWindow(["Argon"], true);

  const toWindowView = (label: string, raw?: typeof windows[0]): WindowView => {
    if (!raw) {
      return { label, remainingPercent: 100, resetText: "" };
    }
    // raw.percent is used percent. remaining percent = 100 - used
    const used = typeof raw.percent === "number" && Number.isFinite(raw.percent) ? raw.percent : 0;
    const remaining = Math.max(0, Math.min(100, Math.round(100 - used)));
    return {
      label,
      remainingPercent: remaining,
      resetText: formatAntigravityReset(raw.resetAt),
    };
  };

  const cla5h = toWindowView("5h", cla5hRaw);
  const claWeekly = toWindowView("Weekly", claWeeklyRaw);
  const gem5h = toWindowView("5h", gem5hRaw);
  const gemWeekly = toWindowView("Weekly", gemWeeklyRaw);

  const hasArgon = Boolean(argon5hRaw || argonWeeklyRaw);
  const argon5h = toWindowView("5h", argon5hRaw);
  const argonWeekly = toWindowView("Weekly", argonWeeklyRaw);

  return (
    <div className="ag-quota-card">
      <div className={`ag-quota-grid${hasArgon ? " ag-quota-grid--argon" : ""}`}>
        <div className="ag-quota-col">
          <div className="ag-quota-col-title">Claude</div>
          {renderQuotaWindow(cla5h)}
          {renderQuotaWindow(claWeekly)}
        </div>
        <div className="ag-quota-col">
          <div className="ag-quota-col-title">Gemini</div>
          {renderQuotaWindow(gem5h)}
          {renderQuotaWindow(gemWeekly)}
        </div>
        {hasArgon && (
          <div className="ag-quota-col">
            <div className="ag-quota-col-title">Argon</div>
            {argon5hRaw ? (
              renderQuotaWindow(argon5h)
            ) : (
              <div className="ag-quota-window">
                <div className="ag-quota-head">
                  <span className="ag-quota-label">5h</span>
                  <span className="ag-quota-pct" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                    不限
                  </span>
                </div>
                <div className="ag-quota-bar-track">
                  <div
                    className="ag-quota-bar-fill ag-quota-bar-fill--healthy"
                    style={{ width: "100%", opacity: 0.35 }}
                  />
                </div>
              </div>
            )}
            {renderQuotaWindow(argonWeekly)}
          </div>
        )}
      </div>
      <div className="ag-quota-credits">
        <span>可用 AI 积分:</span>
      </div>
    </div>
  );
}

export default AntigravityQuotaCard;
