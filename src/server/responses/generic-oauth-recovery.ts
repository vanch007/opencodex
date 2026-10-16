import type { OcxConfig } from "../../types";
import type { OAuthAccessSnapshot } from "../../oauth";
import {
  isAntigravityAccountVerificationError,
  isGenericOAuthFailoverEnabled,
  rotateAntigravityAccountOnVerificationRequired,
} from "../../oauth/generic-account-failover";
import { isNonReplayableResponse } from "../../lib/upstream-retry";
import { readDisplaySafeErrorText } from "./core-errors";

/** Legacy native/continuation compatibility: inspect only a bounded verification denial. */
async function isAntigravityVerificationRefusal(
  response: Response, providerName: string, signal: AbortSignal,
): Promise<boolean> {
  return response.status === 403 && providerName === "google-antigravity"
    && isAntigravityAccountVerificationError(403, await readDisplaySafeErrorText(response.clone(), signal, ""));
}

/** Preserve the shared replay gate and rate-limit cap; verification quarantine is independent of retry slots. */
export async function canRecoverGenericOAuthResponse(
  config: OcxConfig, providerName: string,
  state: { genericFailovers: number; genericFailoverLimit: number },
  response: Response, signal: AbortSignal,
): Promise<boolean> {
  return (response.status === 429 || await isAntigravityVerificationRefusal(response, providerName, signal))
    && !isNonReplayableResponse(response)
    && (response.status === 403 || (state.genericFailovers < state.genericFailoverLimit
      && isGenericOAuthFailoverEnabled(config, providerName)));
}

/** Retire only the credential generation that served the refusal; preserve the original denial if no sibling remains. */
export async function rotateAntigravityVerificationAccount(
  config: OcxConfig, modelId: string, accountId: string, snapshot?: Pick<OAuthAccessSnapshot, "accountId" | "generation">,
): Promise<string | null> {
  if (snapshot?.accountId !== accountId) return null;
  return rotateAntigravityAccountOnVerificationRequired(
    config, accountId, snapshot.generation, Date.now(), modelId,
  );
}
