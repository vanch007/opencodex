import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAccountLogLabel, oauthAccountLogLabel } from "../../src/codex/account-label";
import { withLogAccountIdentity } from "../../src/server/management/log-account-identity";
import { getAccountSet, saveCredential, setAccountAlias } from "../../src/oauth/store";
import type { OcxConfig } from "../../src/types";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const oldHome = process.env.OPENCODEX_HOME;
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "ocx-log-account-")); process.env.OPENCODEX_HOME = home; });
afterEach(() => {
  if (oldHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = oldHome;
  removeTreeWithRetry(home);
});

const config = (maskEmails?: boolean): OcxConfig => ({
  port: 10100, defaultProvider: "google-antigravity", providers: {},
  ...(maskEmails === undefined ? {} : { privacy: { maskEmails } }),
  codexAccounts: [{ id: "pool-1", email: "pooluser@example.test", alias: "Work", logLabel: "pabc123" }],
} as unknown as OcxConfig);

async function oauthLabel(email: string, alias?: string): Promise<string> {
  await saveCredential("google-antigravity", {
    access: "synthetic-access", refresh: "synthetic-refresh", expires: Date.now() + 3_600_000,
    accountId: "synthetic-1", email, source: "oauth",
  });
  const account = getAccountSet("google-antigravity")!.accounts[0]!;
  if (alias) await setAccountAlias("google-antigravity", account.id, alias);
  return oauthAccountLogLabel(account.id, "google-antigravity");
}

describe("request log account identity", () => {
  test("names an OAuth account by masked email by default and by alias when set", async () => {
    const label = await oauthLabel("someone@example.test");
    const row = withLogAccountIdentity({ provider: "google-antigravity", accountLogLabel: label }, config());
    expect(row.accountIdentity).toMatchObject({ label, name: "s***e@example.test" });
    await setAccountAlias("google-antigravity", getAccountSet("google-antigravity")!.accounts[0]!.id, "Primary");
    const aliased = withLogAccountIdentity({ provider: "google-antigravity", accountLogLabel: label }, config());
    expect(aliased.accountIdentity).toMatchObject({ name: "Primary", alias: "Primary", email: "s***e@example.test" });
  });

  test("reveals the full email only when privacy.maskEmails is false", async () => {
    const label = await oauthLabel("someone@example.test");
    const row = withLogAccountIdentity({ provider: "google-antigravity", accountLogLabel: label }, config(false));
    expect(row.accountIdentity?.name).toBe("someone@example.test");
  });

  test("resolves Codex pool and main labels, including per-attempt labels", () => {
    const label = codexAccountLogLabel(config().codexAccounts![0]!);
    const row = withLogAccountIdentity({
      provider: "openai", accountLogLabel: label,
      attempts: [{ provider: "openai", accountLogLabel: "main" }, { provider: "openai" }],
    }, config());
    expect(row.accountIdentity).toMatchObject({ name: "Work", alias: "Work" });
    const attempts = row.attempts as Array<{ accountIdentity?: { name?: string } }>;
    expect(attempts[0]?.accountIdentity?.name).toBe("Codex main");
    expect(attempts[1]?.accountIdentity).toBeUndefined();
  });

  test("leaves rows alone when the account is gone or the label is unknown", () => {
    const row = withLogAccountIdentity({ provider: "google-antigravity", accountLogLabel: "o000000" }, config());
    expect(row).not.toHaveProperty("accountIdentity");
    const bare = withLogAccountIdentity({ provider: "google-antigravity" }, config());
    expect(bare).not.toHaveProperty("accountIdentity");
  });
});
