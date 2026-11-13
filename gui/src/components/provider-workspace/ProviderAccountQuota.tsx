import { parseQuotaFailureCode } from "../../../../src/providers/quota-types";
import { useT } from "../../i18n/shared";
import { accountQuotaFromReport } from "../../provider-workspace/report";
import { formatRelativeTime, relativeTimeLabelsFromT } from "../../provider-workspace/usage";
import { AntigravityQuotaCard, isAntigravityQuota } from "./AntigravityQuotaCard";
import { ProviderCapacityQuota } from "./ProviderCapacityQuota";
import type { AccountQuotaReading } from "./types";

/** The same reading states and credit/window renderer for current and all-account views. */
export default function ProviderAccountQuota({
  quota: rawQuota,
  quotaMode,
  quotaUnavailable,
  quotaPending,
  quotaFailure,
  quotaReadAt,
  provider,
  plan,
  hideArgon,
}: AccountQuotaReading & { provider?: string }) {
  const t = useT();
  const quota = accountQuotaFromReport({ quota: rawQuota });
  if (quotaMode === "unsupported") {
    return <p className="muted" data-quota-state="unsupported">{t("pws.quotaUnsupported")}</p>;
  }
  const failure = quotaMode === "probe" && quotaUnavailable ? parseQuotaFailureCode(quotaFailure) : undefined;
  const pending = quotaMode === "probe" && quotaPending === true;
  const state = quotaUnavailable ? "unavailable" : pending ? "pending" : quota ? "ready" : quotaMode === "passive" ? "unobserved" : "unknown";
  const isAntigravity = provider === "google-antigravity" || isAntigravityQuota(quota) || isAntigravityQuota(rawQuota);
  const shouldHideArgon = hideArgon ?? (plan ?? "").toLowerCase().includes("free");

  return <div data-quota-state={state}>
    {quotaUnavailable && <p className="muted pwi-auth-acct-quota-stale">{t(failure ? `pws.quotaFailure.${failure}` : "pws.accountQuotaUnavailable")}</p>}
    {quota || pending ? (
      isAntigravity ? (
        <AntigravityQuotaCard quota={quota} pending={pending && !quota} hideArgon={shouldHideArgon} plan={plan} />
      ) : (
        <ProviderCapacityQuota
          report={{ quota, updatedAt: quota?.updatedAt, ...(quotaMode === "passive" ? { observed: true } : {}) }}
          pending={pending && !quota}
          hideArgon={shouldHideArgon}
        />
      )
    ) : !quotaUnavailable && (
      <p className="muted">{t(quotaMode === "passive" ? "pws.quotaUnobserved" : "pws.quotaUnavailable")}</p>
    )}
    {quotaUnavailable && quota && !isAntigravity && <p className="muted">
      {t("pws.stats.quotaUpdated")}: {formatRelativeTime(quota.updatedAt, relativeTimeLabelsFromT(t))}
    </p>}
    {/* #8397: an unknown balance says when it was last read. */}
    {(quotaUnavailable || !quota) && !pending && typeof quotaReadAt === "number" && <p className="muted">
      {t("pws.quotaLastRead")}: {formatRelativeTime(quotaReadAt, relativeTimeLabelsFromT(t))}
    </p>}
  </div>;
}
