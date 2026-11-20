import { useCallback, useEffect, useRef, useState } from "react";
import type { UnifiedAccountItem } from "../../types/account";
import { openBrowserRequestField } from "../../oauth-open-browser-pref";
import { parseBrowserLaunch } from "../../oauth-browser-launch";
import { oauthRiskAcknowledgementBody, oauthTosRisk } from "../../oauth-tos-risk";
import { oauthLabel } from "../../pages/providers-shared";
import { useT } from "../../i18n/shared";

export type PendingOAuthTos = { provider: string; forEmail?: string };

const OAUTH_POLL_MAX_ATTEMPTS = 120;
const DEFAULT_OAUTH_POLL_INTERVAL_MS = 1500;

export function useAccountsOAuth({
  apiBase,
  accounts,
  onOpenCodexModal,
  onCopyEmail,
  onAccountsChanged,
  pollIntervalMs = DEFAULT_OAUTH_POLL_INTERVAL_MS,
}: {
  apiBase: string;
  accounts: UnifiedAccountItem[];
  onOpenCodexModal: () => void;
  onCopyEmail: (email: string) => void;
  onAccountsChanged: () => Promise<void>;
  pollIntervalMs?: number;
}) {
  const t = useT();
  const [oauthBusyProvider, setOauthBusyProvider] = useState<string | null>(null);
  const [targetEmailForOAuth, setTargetEmailForOAuth] = useState<string | null>(null);
  const [oauthLoginUrl, setOauthLoginUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthTosPending, setOauthTosPending] = useState<PendingOAuthTos | null>(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const busyRef = useRef<string | null>(null);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const clearBusyState = useCallback(() => {
    busyRef.current = null;
    setOauthBusyProvider(null);
    setTargetEmailForOAuth(null);
    setOauthLoginUrl(null);
  }, []);

  const startOAuthLogin = useCallback(async (provider: string, forEmail?: string, riskAcknowledged = false) => {
    if (busyRef.current !== null) return;
    const gen = ++generationRef.current;
    const baselineCount = accountsRef.current.filter(a => a.provider === provider).length;
    busyRef.current = provider;
    setOauthError(null);
    setOauthBusyProvider(provider);
    setTargetEmailForOAuth(forEmail ?? null);
    setOauthLoginUrl(null);

    try {
      const res = await fetch(`${apiBase}/api/oauth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          addAccount: true,
          ...openBrowserRequestField(),
          ...oauthRiskAcknowledgementBody(provider, riskAcknowledged),
        }),
      });
      const data = await res.json().catch(() => ({})) as { url?: string; browserLaunch?: unknown; error?: string };
      if (!mountedRef.current || generationRef.current !== gen) return;
      if (!res.ok || data.error) {
        setOauthError(data.error || t("prov.loginFailStart", { provider: oauthLabel(provider) }));
        clearBusyState();
        return;
      }
      if (data.url) {
        setOauthLoginUrl(data.url);
        if (parseBrowserLaunch(data.browserLaunch) !== "started") {
          window.open(data.url, "_blank", "noopener,noreferrer");
        }
      }

      void (async () => {
        let settled = false;
        try {
          for (let i = 0; i < OAUTH_POLL_MAX_ATTEMPTS; i++) {
            await new Promise(r => setTimeout(r, pollIntervalMs));
            if (!mountedRef.current || generationRef.current !== gen) return;
            const sRes = await fetch(`${apiBase}/api/oauth/status?provider=${encodeURIComponent(provider)}`).catch(() => null);
            if (!mountedRef.current || generationRef.current !== gen) return;
            if (!sRes || !sRes.ok) continue;
            const s = await sRes.json().catch(() => null) as {
              loggedIn?: boolean;
              status?: string;
              done?: boolean;
              error?: string;
              accounts?: Array<unknown>;
            } | null;
            if (!mountedRef.current || generationRef.current !== gen) return;
            if (!s) continue;
            if (s.error || s.status === "error") {
              settled = true;
              if (!/cancel/i.test(s.error ?? "")) {
                setOauthError(s.error || t("prov.loginFailStart", { provider: oauthLabel(provider) }));
              }
              break;
            }
            const statusCount = Array.isArray(s.accounts) ? s.accounts.length : 0;
            // Re-check status/done/count rather than `s.loggedIn`, which is already true when
            // at least one account exists and would terminate multi-account polling prematurely.
            const completed = s.status === "complete" || s.done === true || statusCount > baselineCount;
            if (completed) {
              settled = true;
              await onAccountsChanged();
              break;
            }
          }
          if (!settled && mountedRef.current && generationRef.current === gen) {
            setOauthError(t("prov.loginTimeout", { provider: oauthLabel(provider) }));
            void fetch(`${apiBase}/api/oauth/login/cancel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider }),
            }).catch(() => {});
          }
        } finally {
          if (mountedRef.current && generationRef.current === gen) {
            clearBusyState();
          }
        }
      })();
    } catch {
      if (mountedRef.current && generationRef.current === gen) {
        setOauthError(t("prov.loginRequestFail", { provider: oauthLabel(provider) }));
        clearBusyState();
      }
    }
  }, [apiBase, clearBusyState, onAccountsChanged, pollIntervalMs, t]);

  const requestAddOAuthAccount = useCallback((provider: string, forEmail?: string) => {
    if (forEmail) {
      onCopyEmail(forEmail);
    }
    setOauthError(null);
    if (provider === "openai") {
      setTargetEmailForOAuth(forEmail ?? null);
      onOpenCodexModal();
      return;
    }
    if (busyRef.current !== null) return;
    if (oauthTosRisk(provider)) {
      setOauthTosPending({ provider, ...(forEmail ? { forEmail } : {}) });
      return;
    }
    void startOAuthLogin(provider, forEmail, false);
  }, [onCopyEmail, onOpenCodexModal, startOAuthLogin]);

  const cancelOAuthTos = useCallback(() => {
    setOauthTosPending(null);
  }, []);

  const continueOAuthTos = useCallback(() => {
    const pending = oauthTosPending;
    if (!pending) return;
    setOauthTosPending(null);
    void startOAuthLogin(pending.provider, pending.forEmail, true);
  }, [oauthTosPending, startOAuthLogin]);

  const cancelActiveOAuthLogin = useCallback(() => {
    const provider = busyRef.current;
    generationRef.current += 1;
    clearBusyState();
    if (!provider) return;
    void fetch(`${apiBase}/api/oauth/login/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    }).catch(() => {});
  }, [apiBase, clearBusyState]);

  const clearOAuthError = useCallback(() => {
    setOauthError(null);
  }, []);

  const clearTargetEmail = useCallback(() => {
    setTargetEmailForOAuth(null);
  }, []);

  return {
    oauthBusyProvider,
    targetEmailForOAuth,
    oauthLoginUrl,
    oauthError,
    oauthTosPending,
    requestAddOAuthAccount,
    cancelOAuthTos,
    continueOAuthTos,
    cancelActiveOAuthLogin,
    clearOAuthError,
    clearTargetEmail,
  };
}
