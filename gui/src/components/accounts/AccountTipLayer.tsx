import React, { useEffect, useState } from "react";

interface Tip {
  text: string;
  left: number;
  top: number;
}

/**
 * Hover labels for the account page's icon buttons and status badges.
 *
 * A single fixed-position layer reads `data-tip` (or migrates `title` on first hover) from whatever
 * element inside `.cockpit-accounts-page` the pointer is over, so the label is never clipped by the
 * table's horizontal-scroll wrapper and does not depend on the webview rendering native `title` tooltips.
 */
export const AccountTipLayer: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const show = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        setTip(null);
        return;
      }
      const target = event.target.closest<HTMLElement>(
        ".cockpit-accounts-page [data-tip], .cockpit-accounts-page [title]",
      );
      if (!target) {
        setTip(null);
        return;
      }
      if (!target.dataset.tip && target.getAttribute("title")) {
        target.dataset.tip = target.getAttribute("title") ?? "";
        target.removeAttribute("title");
      }
      const text = target.dataset.tip?.trim();
      if (!text) {
        setTip(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const rawLeft = rect.left + rect.width / 2;
      const clampedLeft = typeof window !== "undefined"
        ? Math.max(90, Math.min(window.innerWidth - 140, rawLeft))
        : rawLeft;
      setTip({ text, left: clampedLeft, top: rect.top });
    };
    const hide = () => setTip(null);
    document.addEventListener("mouseover", show);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("mousedown", hide);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("mousedown", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: tip.left,
        top: tip.top - 8,
        transform: "translate(-50%, -100%)",
        maxWidth: 280,
        padding: "5px 9px",
        borderRadius: 6,
        background: "rgba(24, 24, 27, 0.96)",
        color: "#fafafa",
        fontSize: 12,
        lineHeight: 1.4,
        whiteSpace: "pre-line",
        pointerEvents: "none",
        zIndex: 10000,
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
      }}
    >
      {tip.text}
    </div>
  );
};
