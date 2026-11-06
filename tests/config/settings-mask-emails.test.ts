import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { handleManagementAPI } from "../../src/server/management-api";
import { invalidateStartupHealthCache } from "../../src/server/startup-health-cache";
import type { OcxConfig } from "../../src/types";
import { startupHealthFixture } from "../helpers/startup-health";
import { removeTreeWithRetry } from "../helpers/remove-tree";

let testDir: string;
let previousHome: string | undefined;
const baseConfig = (): OcxConfig => ({ port: 10100, defaultProvider: "openai", providers: { openai: { adapter: "openai-chat", baseUrl: "https://api.example.test/v1", apiKey: "fixture-key", defaultModel: "gpt-test" } } });

function request(config: OcxConfig, body?: unknown) {
  const req = new Request("http://127.0.0.1:10100/api/settings", {
    method: body === undefined ? "GET" : "PUT",
    headers: { host: "127.0.0.1:10100", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handleManagementAPI(req, new URL(req.url), config, { getCachedStartupHealth: async () => startupHealthFixture() });
}

beforeEach(() => {
  previousHome = process.env.OPENCODEX_HOME;
  testDir = mkdtempSync(join(tmpdir(), "ocx-mask-emails-settings-"));
  process.env.OPENCODEX_HOME = testDir;
  invalidateStartupHealthCache();
});
afterEach(() => {
  invalidateStartupHealthCache();
  if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousHome;
  removeTreeWithRetry(testDir);
});

describe("settings maskEmails", () => {
  test("defaults to masked and round-trips an explicit unmask and re-mask", async () => {
    const config = baseConfig();
    expect(await (await request(config))!.json()).toMatchObject({ maskEmails: true });
    const off = await request(config, { maskEmails: false });
    expect(off?.status).toBe(200);
    expect(await off!.json()).toMatchObject({ ok: true, maskEmails: false });
    expect(config.privacy).toEqual({ maskEmails: false });
    expect(loadConfig().privacy?.maskEmails).toBe(false);
    const on = await request(config, { maskEmails: true });
    expect(await on!.json()).toMatchObject({ ok: true, maskEmails: true });
    expect(config.privacy).toBeUndefined();
    expect(loadConfig().privacy).toBeUndefined();
  });

  test("rejects a non-boolean value without changing the config", async () => {
    const config = baseConfig();
    const response = await request(config, { maskEmails: "false" });
    expect(response?.status).toBe(400);
    expect(config.privacy).toBeUndefined();
  });
});
