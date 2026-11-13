import { describe, expect, test } from "bun:test";
import { handleOAuthAccountHealthTest } from "../../src/server/management/oauth-account-health-test";
import type { OcxConfig } from "../../src/types";

describe("handleOAuthAccountHealthTest", () => {
  const dummyConfig = {
    providers: {
      "google-antigravity": {
        adapter: "google",
        baseUrl: "https://daily-cloudcode-pa.googleapis.com",
      },
    },
  } as unknown as OcxConfig;

  test("rejects missing provider or accountId", async () => {
    const req = new Request("http://localhost/api/oauth/accounts/test-health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleOAuthAccountHealthTest(req, dummyConfig);
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent account", async () => {
    const req = new Request("http://localhost/api/oauth/accounts/test-health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google-antigravity", accountId: "nonexistent-id" }),
    });
    const res = await handleOAuthAccountHealthTest(req, dummyConfig);
    expect(res.status).toBe(404);
  });
});

