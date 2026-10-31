import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOAuthInfo,
  createUnifiedTopicEntry,
  removeUnifiedTopicEntry,
  createMinimalUserStatusPayload,
} from "../../src/oauth/antigravity-ide-sync";

describe("Antigravity IDE protobuf serialization & sync", () => {
  test("creates and manipulates unified topic entries correctly", () => {
    const payload1 = new TextEncoder().encode("payload-for-key1");
    const payload2 = new TextEncoder().encode("payload-for-key2");

    const entry1 = createUnifiedTopicEntry("key1", payload1);
    const entry2 = createUnifiedTopicEntry("key2", payload2);

    const topic = new Uint8Array(entry1.length + entry2.length);
    topic.set(entry1, 0);
    topic.set(entry2, entry1.length);

    // Remove key1
    const stripped1 = removeUnifiedTopicEntry(topic, "key1");
    expect(stripped1.length).toBe(entry2.length);

    // Remove key2 from stripped
    const stripped2 = removeUnifiedTopicEntry(stripped1, "key2");
    expect(stripped2.length).toBe(0);
  });

  test("creates valid oauth info protobuf message", () => {
    const oauthInfo = createOAuthInfo(
      "access_token_123",
      "refresh_token_456",
      1793460000,
      false,
      "optional_id_token"
    );

    expect(oauthInfo.length).toBeGreaterThan(0);
    // Contains "Bearer"
    const text = new TextDecoder().decode(oauthInfo);
    expect(text).toContain("Bearer");
    expect(text).toContain("access_token_123");
    expect(text).toContain("refresh_token_456");
  });

  test("creates minimal user status payload with email", () => {
    const statusPayload = createMinimalUserStatusPayload("test@example.com");
    expect(statusPayload.length).toBeGreaterThan(0);
    const text = new TextDecoder().decode(statusPayload);
    expect(text).toContain("test@example.com");
  });

  test("injects into SQLite database table correctly", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ag-ide-sync-test-"));
    const dbPath = join(tempDir, "state.vscdb");

    try {
      const db = new Database(dbPath);
      db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");

      // Seed an existing topic with another sentinel key
      const dummyOtherEntry = createUnifiedTopicEntry(
        "authStateWithContextSentinelKey",
        new TextEncoder().encode(JSON.stringify({ state: "signedIn" }))
      );
      const initialTopicB64 = Buffer.from(dummyOtherEntry).toString("base64");
      db.run(
        "INSERT INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.oauthToken', ?)",
        [initialTopicB64]
      );
      db.close();

      // Simulate injection using the same logic
      const targetDb = new Database(dbPath);
      const row = targetDb
        .query("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'")
        .get() as { value: string };

      const existing = new Uint8Array(Buffer.from(row.value, "base64"));
      const baseTopic = removeUnifiedTopicEntry(existing, "oauthTokenInfoSentinelKey");

      const oauthInfoBytes = createOAuthInfo("acc_new", "ref_new", 1800000000);
      const newEntry = createUnifiedTopicEntry("oauthTokenInfoSentinelKey", oauthInfoBytes);
      const fullTopic = new Uint8Array(baseTopic.length + newEntry.length);
      fullTopic.set(baseTopic, 0);
      fullTopic.set(newEntry, baseTopic.length);

      targetDb
        .query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
        .run("antigravityUnifiedStateSync.oauthToken", Buffer.from(fullTopic).toString("base64"));

      const statusPayload = createMinimalUserStatusPayload("user@gmail.com");
      const statusEntry = createUnifiedTopicEntry("userStatusSentinelKey", statusPayload);
      targetDb
        .query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
        .run("antigravityUnifiedStateSync.userStatus", Buffer.from(statusEntry).toString("base64"));

      targetDb
        .query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
        .run("antigravityOnboarding", "true");

      targetDb.close();

      // Verify records
      const verifyDb = new Database(dbPath, { readonly: true });
      const oauthRow = verifyDb
        .query("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'")
        .get() as { value: string };
      const statusRow = verifyDb
        .query("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.userStatus'")
        .get() as { value: string };
      const onboardRow = verifyDb
        .query("SELECT value FROM ItemTable WHERE key = 'antigravityOnboarding'")
        .get() as { value: string };

      verifyDb.close();

      expect(oauthRow).toBeDefined();
      expect(statusRow).toBeDefined();
      expect(onboardRow.value).toBe("true");

      const decodedOauth = Buffer.from(oauthRow.value, "base64").toString("utf-8");
      expect(decodedOauth).toContain("authStateWithContextSentinelKey");
      expect(decodedOauth).toContain("oauthTokenInfoSentinelKey");

      // The inner oauthInfo payload is Base64 encoded inside the Topic row
      const innerMatch = decodedOauth.match(/(CgdhY2[A-Za-z0-9+/=]+)/);
      expect(innerMatch).toBeDefined();
      const innerDecoded = Buffer.from(innerMatch![1], "base64").toString("utf-8");
      expect(innerDecoded).toContain("acc_new");
      expect(innerDecoded).toContain("ref_new");

      const decodedStatus = Buffer.from(statusRow.value, "base64").toString("utf-8");
      expect(decodedStatus).toContain("userStatusSentinelKey");
      const statusInnerMatch = decodedStatus.match(/(Gg[A-Za-z0-9+/=]+)/);
      expect(statusInnerMatch).toBeDefined();
      const statusInnerDecoded = Buffer.from(statusInnerMatch![1], "base64").toString("utf-8");
      expect(statusInnerDecoded).toContain("user@gmail.com");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
