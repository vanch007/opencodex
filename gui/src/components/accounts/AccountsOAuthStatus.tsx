import OAuthTosWarningModal from "../OAuthTosWarningModal";
import { IconRefresh } from "../../icons";
import { useT } from "../../i18n/shared";
import { oauthLabel } from "../../pages/providers-shared";
import type { useAccountsOAuth } from "./use-accounts-oauth";

export type AccountsOAuthController = ReturnType<typeof useAccountsOAuth>;

function isOpenableAuthUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function AccountsOAuthStatus({ oauth }: { oauth: AccountsOAuthController }) {
  const t = useT();
  const {
    oauthBusyProvider,
    targetEmailForOAuth,
    oauthLoginUrl,
    oauthError,
    oauthTosPending,
    cancelOAuthTos,
    continueOAuthTos,
    cancelActiveOAuthLogin,
    clearOAuthError,
  } = oauth;

  return (
    <>
      {oauthBusyProvider && (
        <div
          role="status"
          style={{
            margin: "0 0 12px 0",
            padding: "8px 14px",
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            borderRadius: "var(--radius-sm, 8px)",
            fontSize: "13px",
            color: "#3b82f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <IconRefresh className="spin" style={{ width: 14, height: 14 }} />
            <span>
              正在等待 {oauthLabel(oauthBusyProvider)} 浏览器授权完成
              {targetEmailForOAuth ? `（已自动复制目标邮箱 ${targetEmailForOAuth} 到剪贴板）` : "..."}
            </span>
            {isOpenableAuthUrl(oauthLoginUrl) && (
              <a
                href={oauthLoginUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "underline", fontWeight: 500 }}
              >
                {t("prov.didntOpen")}
              </a>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={cancelActiveOAuthLogin}
          >
            {t("common.cancel")}
          </button>
        </div>
      )}

      {oauthError && (
        <div
          role="alert"
          className="notice-err"
          style={{
            margin: "0 0 12px 0",
            padding: "8px 14px",
            borderRadius: "var(--radius-sm, 8px)",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span>{oauthError}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={t("common.close")}
            onClick={clearOAuthError}
          >
            {t("common.close")}
          </button>
        </div>
      )}

      {oauthTosPending && (
        <OAuthTosWarningModal
          key={`${oauthTosPending.provider}:${oauthTosPending.forEmail ?? ""}`}
          providerId={oauthTosPending.provider}
          providerLabel={oauthLabel(oauthTosPending.provider)}
          onCancel={cancelOAuthTos}
          onContinue={continueOAuthTos}
        />
      )}
    </>
  );
}
