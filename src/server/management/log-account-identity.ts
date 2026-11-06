import { codexAccountLogLabel, oauthAccountLogLabel } from "../../codex/account-label";
import { MAIN_CODEX_ACCOUNT_ID } from "../../codex/account-id";
import { emailMaskingEnabled, projectEmail } from "../../lib/privacy";
import { baseProviderLabel } from "../../providers/label";
import { getAccountSet } from "../../oauth/store";
import type { OcxConfig } from "../../types";

/** Operator-facing name of the account behind a request-log label; never a credential. */
export interface LogAccountIdentity {
  label: string;
  /** Alias when set, otherwise the (possibly masked) email; absent when neither is known. */
  name?: string;
  email?: string;
  alias?: string;
}

type Resolver = (label: string, provider: string) => LogAccountIdentity | undefined;

function codexResolver(config: OcxConfig, mask: boolean): Resolver {
  return (label) => {
    if (label === "main") return { label, name: "Codex main" };
    if (!/^p[a-f0-9]{6}$/.test(label)) return undefined;
    const matches = (config.codexAccounts ?? []).filter(account =>
      account.id !== MAIN_CODEX_ACCOUNT_ID && codexAccountLogLabel(account) === label);
    if (matches.length !== 1) return undefined;
    const account = matches[0]!;
    const email = projectEmail(account.email, mask) ?? undefined;
    const alias = account.alias?.trim() || undefined;
    return { label, name: alias ?? email, ...(email ? { email } : {}), ...(alias ? { alias } : {}) };
  };
}

function oauthResolver(mask: boolean): Resolver {
  return (label, provider) => {
    if (!/^o[a-f0-9]{6}$/.test(label)) return undefined;
    const base = baseProviderLabel(provider);
    const matches = (getAccountSet(provider)?.accounts ?? []).filter(account =>
      oauthAccountLogLabel(account.id, base) === label);
    // Two accounts can share a six-hex label; naming one of them would be a guess.
    if (matches.length !== 1) return undefined;
    const account = matches[0]!;
    const email = projectEmail(account.credential.email, mask) ?? undefined;
    const alias = account.alias?.trim() || undefined;
    return { label, name: alias ?? email, ...(email ? { email } : {}), ...(alias ? { alias } : {}) };
  };
}

/**
 * Add `accountIdentity` to a log row and to each attempt that carries an account label.
 *
 * The persisted row only stores a hashed label so the log file stays free of addresses; the
 * readable name is derived here at read time from the accounts that exist now, and honours
 * `privacy.maskEmails`. A deleted or ambiguous account simply gets no identity.
 */
export function withLogAccountIdentity<T extends Record<string, unknown>>(
  row: T,
  config: OcxConfig,
  cache: { codex?: Resolver; oauth?: Resolver; mask?: boolean } = {},
): T {
  const mask = cache.mask ??= emailMaskingEnabled(config);
  const codex = cache.codex ??= codexResolver(config, mask);
  const oauth = cache.oauth ??= oauthResolver(mask);
  const resolve = (label: unknown, provider: unknown): LogAccountIdentity | undefined => {
    if (typeof label !== "string" || typeof provider !== "string") return undefined;
    return codex(label, provider) ?? oauth(label, provider);
  };
  const identity = resolve(row.accountLogLabel, row.provider);
  const attempts = Array.isArray(row.attempts)
    ? row.attempts.map((attempt: Record<string, unknown>) => {
      const found = resolve(attempt.accountLogLabel, attempt.provider ?? row.provider);
      return found ? { ...attempt, accountIdentity: found } : attempt;
    })
    : undefined;
  return {
    ...row,
    ...(identity ? { accountIdentity: identity } : {}),
    ...(attempts ? { attempts } : {}),
  };
}
