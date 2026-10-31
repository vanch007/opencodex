import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { OAuthCredentials } from "./types";
import { refreshAntigravityToken } from "./google-antigravity";

/**
 * Returns the candidate paths for Antigravity IDE state.vscdb SQLite file.
 */
export function getAntigravityStateDbPath(): string | null {
  const currentPlatform = platform();
  let candidate: string;

  if (currentPlatform === "darwin") {
    candidate = join(
      homedir(),
      "Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb"
    );
  } else if (currentPlatform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData/Roaming");
    candidate = join(appData, "Antigravity IDE/User/globalStorage/state.vscdb");
  } else {
    candidate = join(homedir(), ".config/Antigravity IDE/User/globalStorage/state.vscdb");
  }

  return existsSync(candidate) ? candidate : null;
}

// ======================== Protobuf Encoders ========================

function encodeVarint(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  const bytes: number[] = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return new Uint8Array(bytes);
}

function encodeLenDelimField(fieldNum: number, data: Uint8Array): Uint8Array {
  const tag = (fieldNum << 3) | 2;
  const tagBuf = encodeVarint(tag);
  const lenBuf = encodeVarint(data.length);
  const out = new Uint8Array(tagBuf.length + lenBuf.length + data.length);
  out.set(tagBuf, 0);
  out.set(lenBuf, tagBuf.length);
  out.set(data, tagBuf.length + lenBuf.length);
  return out;
}

function encodeStringField(fieldNum: number, value: string): Uint8Array {
  return encodeLenDelimField(fieldNum, new TextEncoder().encode(value));
}

function encodeVarintField(fieldNum: number, value: number | bigint): Uint8Array {
  const tag = (fieldNum << 3) | 0;
  const tagBuf = encodeVarint(tag);
  const valBuf = encodeVarint(value);
  const out = new Uint8Array(tagBuf.length + valBuf.length);
  out.set(tagBuf, 0);
  out.set(valBuf, tagBuf.length);
  return out;
}

function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function readVarint(data: Uint8Array, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < data.length) {
    const byte = data[pos];
    result |= BigInt(byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, pos];
}

function skipField(data: Uint8Array, offset: number, wireType: number): number {
  switch (wireType) {
    case 0: {
      const [, newOffset] = readVarint(data, offset);
      return newOffset;
    }
    case 1:
      return offset + 8;
    case 2: {
      const [len, contentOffset] = readVarint(data, offset);
      return contentOffset + Number(len);
    }
    case 5:
      return offset + 4;
    default:
      throw new Error(`Unknown wireType: ${wireType}`);
  }
}

function getUnifiedTopicEntryKey(entryData: Uint8Array): string | null {
  let offset = 0;
  while (offset < entryData.length) {
    const [tag, newOffset] = readVarint(entryData, offset);
    const wireType = Number(tag & 7n);
    const fieldNum = Number(tag >> 3n);
    if (fieldNum === 1 && wireType === 2) {
      const [len, contentOffset] = readVarint(entryData, newOffset);
      const strBytes = entryData.subarray(contentOffset, contentOffset + Number(len));
      return new TextDecoder().decode(strBytes);
    }
    offset = skipField(entryData, newOffset, wireType);
  }
  return null;
}

export function removeUnifiedTopicEntry(data: Uint8Array, targetKey: string): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const startOffset = offset;
    const [tag, newOffset] = readVarint(data, offset);
    const wireType = Number(tag & 7n);
    const fieldNum = Number(tag >> 3n);
    const nextOffset = skipField(data, newOffset, wireType);

    let shouldRemove = false;
    if (fieldNum === 1 && wireType === 2) {
      const [len, contentOffset] = readVarint(data, newOffset);
      const entryBytes = data.subarray(contentOffset, contentOffset + Number(len));
      if (getUnifiedTopicEntryKey(entryBytes) === targetKey) {
        shouldRemove = true;
      }
    }

    if (!shouldRemove) {
      parts.push(data.subarray(startOffset, nextOffset));
    }
    offset = nextOffset;
  }
  return concatArrays(...parts);
}

export function createOAuthInfo(
  accessToken: string,
  refreshToken: string,
  expirySeconds: number,
  isGcpTos = false,
  idToken?: string,
): Uint8Array {
  const field1 = encodeStringField(1, accessToken);
  const field2 = encodeStringField(2, "Bearer");
  const field3 = encodeStringField(3, refreshToken);

  const timestampMsg = concatArrays(
    encodeVarintField(1, expirySeconds),
    encodeVarintField(2, 0),
  );
  const field4 = encodeLenDelimField(4, timestampMsg);

  const parts = [field1, field2, field3, field4];
  if (idToken?.trim()) {
    parts.push(encodeStringField(5, idToken.trim()));
  }
  if (isGcpTos) {
    parts.push(encodeVarintField(6, 1));
  }
  return concatArrays(...parts);
}

export function createUnifiedTopicEntry(sentinelKey: string, payload: Uint8Array): Uint8Array {
  const b64 = Buffer.from(payload).toString("base64");
  const row = encodeStringField(1, b64);
  const entry = concatArrays(
    encodeStringField(1, sentinelKey),
    encodeLenDelimField(2, row),
  );
  return encodeLenDelimField(1, entry);
}

/**
 * Encodes a unified topic entry where Row.value (field 1) is a raw UTF-8 string
 * rather than Base64-encoded protobuf bytes. Used by Antigravity IDE 2.6.0's
 * `authStateWithContextSentinelKey` (`Gka(e, t)` in `antigravityAuthMainService.js`).
 */
export function createUnifiedTopicRawStringEntry(sentinelKey: string, rawString: string): Uint8Array {
  const row = encodeStringField(1, rawString);
  const entry = concatArrays(
    encodeStringField(1, sentinelKey),
    encodeLenDelimField(2, row),
  );
  return encodeLenDelimField(1, entry);
}

export function createMinimalUserStatusPayload(email: string): Uint8Array {
  return concatArrays(
    encodeStringField(3, email),
    encodeStringField(7, email),
  );
}

export function createSignedInAuthStateJson(): string {
  return JSON.stringify({
    state: "signedIn",
    context: {
      project: "",
      showProjectError: false,
      errorMessage: "",
      ineligibleMessage: "",
      verificationUrl: "",
      isGcpTos: false,
      browserOpenFailed: false,
      appealUrl: "",
      appealLinkText: "",
    },
  });
}

// ======================== System Credential Store (agy --hub) ========================

const KEYRING_SERVICE = "gemini";
const KEYRING_ACCOUNT = "antigravity";

export function formatAntigravityKeyringPayload(credentials: {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
}): string {
  const expiryIso = new Date(credentials.expires).toISOString();
  const payload = {
    token: {
      access_token: credentials.access,
      token_type: "Bearer",
      refresh_token: credentials.refresh,
      expiry: expiryIso,
    },
    auth_method: "consumer",
    id_token_email: credentials.email?.trim() ?? "",
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
  return `go-keyring-base64:${b64}`;
}

/**
 * Writes credentials to Antigravity 2.2+ system credential store (macOS Keychain
 * `service=gemini, account=antigravity`) so `agy --hub` recognizes the switched
 * account immediately without prompting to log in.
 */
export async function writeAntigravitySystemCredential(credentials: {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const currentPlatform = platform();
    const keyringVal = formatAntigravityKeyringPayload(credentials);

    if (currentPlatform === "darwin") {
      try {
        const delProc = Bun.spawn(
          ["security", "delete-generic-password", "-s", KEYRING_SERVICE, "-a", KEYRING_ACCOUNT],
          { stdout: "ignore", stderr: "ignore" }
        );
        await delProc.exited;
      } catch {}

      const addProc = Bun.spawn(
        [
          "security",
          "add-generic-password",
          "-U",
          "-s",
          KEYRING_SERVICE,
          "-a",
          KEYRING_ACCOUNT,
          "-w",
          keyringVal,
          "-A",
        ],
        { stdout: "ignore", stderr: "pipe" }
      );
      const exitCode = await addProc.exited;
      if (exitCode !== 0) {
        const errText = await new Response(addProc.stderr).text();
        return { success: false, error: `Keychain write failed (${exitCode}): ${errText.trim()}` };
      }
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ======================== Database Operations ========================

function isConsumerGoogleAccountEmail(email?: string): boolean {
  if (!email) return true;
  const domain = email.trim().toLowerCase().split("@")[1];
  return !domain || domain === "gmail.com" || domain === "googlemail.com";
}

export function injectAntigravityAccountToDb(credentials: {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  idToken?: string;
}): { success: boolean; dbPath: string; error?: string } {
  const dbPath = getAntigravityStateDbPath();
  if (!dbPath) {
    return { success: false, dbPath: "", error: "Antigravity state.vscdb not found" };
  }

  try {
    const db = new Database(dbPath);

    // 1. Update antigravityUnifiedStateSync.oauthToken
    const row = db
      .query("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'")
      .get() as { value: string } | null;

    let baseTopic: Uint8Array = new Uint8Array(0);
    if (row?.value) {
      const existing = new Uint8Array(Buffer.from(row.value, "base64"));
      const withoutToken = removeUnifiedTopicEntry(existing, "oauthTokenInfoSentinelKey");
      baseTopic = removeUnifiedTopicEntry(withoutToken, "authStateWithContextSentinelKey");
    }

    const expirySeconds = Math.floor(credentials.expires / 1000);
    const oauthInfoBytes = createOAuthInfo(
      credentials.access,
      credentials.refresh,
      expirySeconds,
      false,
      credentials.idToken
    );
    const authStateEntry = createUnifiedTopicRawStringEntry(
      "authStateWithContextSentinelKey",
      createSignedInAuthStateJson()
    );
    const newEntry = createUnifiedTopicEntry("oauthTokenInfoSentinelKey", oauthInfoBytes);
    const fullTopic = concatArrays(baseTopic, authStateEntry, newEntry);
    const topicB64 = Buffer.from(fullTopic).toString("base64");

    db.query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
      .run("antigravityUnifiedStateSync.oauthToken", topicB64);

    // 2. Update antigravityUnifiedStateSync.userStatus if email is present
    if (credentials.email?.trim()) {
      const email = credentials.email.trim();
      const statusPayload = createMinimalUserStatusPayload(email);
      const statusEntry = createUnifiedTopicEntry("userStatusSentinelKey", statusPayload);
      const statusB64 = Buffer.from(statusEntry).toString("base64");

      db.query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
        .run("antigravityUnifiedStateSync.userStatus", statusB64);
    }

    // 3. Clear enterprisePreferences for consumer Google accounts
    if (isConsumerGoogleAccountEmail(credentials.email)) {
      db.query("DELETE FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.enterprisePreferences'")
        .run();
    }

    // 4. Set onboarding completed flag
    db.query("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
      .run("antigravityOnboarding", "true");

    db.close();
    return { success: true, dbPath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, dbPath, error: msg };
  }
}

// ======================== Process Management ========================

/**
 * Finds the main Electron PIDs of Antigravity IDE on macOS via `ps -ax -o pid=,command=`.
 * (`pgrep -f` on macOS does not reliably match Electron binaries whose `p_comm` is `Electron`).
 */
export async function findAntigravityIdePids(): Promise<number[]> {
  const currentPlatform = platform();
  if (currentPlatform !== "darwin") return [];
  try {
    const proc = Bun.spawn(["ps", "-ax", "-o", "pid=,command="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const pids: number[] = [];
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (
        (trimmed.includes("/Antigravity IDE.app/Contents/MacOS/Electron") ||
          trimmed.includes("/Antigravity.app/Contents/MacOS/Electron")) &&
        !trimmed.includes("--type=")
      ) {
        const match = trimmed.match(/^(\d+)\s+/);
        if (match) {
          const pid = Number.parseInt(match[1], 10);
          if (Number.isFinite(pid) && pid > 0) pids.push(pid);
        }
      }
    }
    return pids;
  } catch {
    return [];
  }
}

/**
 * Checks if Antigravity IDE application is currently running.
 */
export async function isAntigravityIdeRunning(): Promise<boolean> {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") {
    const pids = await findAntigravityIdePids();
    return pids.length > 0;
  }
  if (currentPlatform === "win32") {
    const proc = Bun.spawn(["tasklist", "/FI", "IMAGENAME eq Antigravity IDE.exe"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    return output.toLowerCase().includes("antigravity ide.exe");
  }
  const proc = Bun.spawn(["pgrep", "-f", "antigravity-ide"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

/**
 * Gracefully requests Antigravity IDE to quit.
 */
export async function requestAntigravityQuit(): Promise<void> {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") {
    const pids = await findAntigravityIdePids();
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    return;
  }

  if (currentPlatform === "win32") {
    try {
      const proc = Bun.spawn(["taskkill", "/IM", "Antigravity IDE.exe"]);
      await proc.exited;
    } catch {}
    return;
  }

  try {
    const proc = Bun.spawn(["pkill", "-TERM", "-f", "antigravity-ide"]);
    await proc.exited;
  } catch {}
}

/**
 * Launches Antigravity IDE.
 */
export function launchAntigravityIde(): void {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") {
    spawn("open", ["-a", "Antigravity IDE"], { detached: true, stdio: "ignore" }).unref();
  } else if (currentPlatform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", "Antigravity IDE.exe"], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("antigravity-ide", [], { detached: true, stdio: "ignore" }).unref();
  }
}

function isTestEnvironment(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  if (typeof Bun !== "undefined" && /\.test\.[jt]sx?$/.test(Bun.main ?? "")) return true;
  const ocxHome = process.env.OPENCODEX_HOME;
  if (ocxHome && !ocxHome.startsWith(homedir())) return true;
  return false;
}

/**
 * High-level helper: Sync an account to Antigravity IDE (both Keychain/credential-user-scope
 * for `agy --hub` and `state.vscdb` for Electron Main).
 * If IDE is running and restartIfRunning is true, gracefully exits, injects DB + Keychain, and relaunches.
 */
export async function syncAntigravityAccountToIde(
  credentials: OAuthCredentials,
  options: { restartIfRunning?: boolean; skipRefresh?: boolean; allowInTests?: boolean } = {}
): Promise<{
  success: boolean;
  ideInjected: boolean;
  ideRunning: boolean;
  ideRestarted: boolean;
  refreshedCredential?: OAuthCredentials;
  message: string;
}> {
  if (isTestEnvironment() && !options.allowInTests) {
    return {
      success: true,
      ideInjected: false,
      ideRunning: false,
      ideRestarted: false,
      message: "Skipped IDE sync in test environment",
    };
  }

  let targetCreds = credentials;
  let refreshedCredential: OAuthCredentials | undefined;

  // 1. Always refresh token before writing into Antigravity IDE so both Keychain and state.vscdb
  // receive a fresh, valid access_token with full expiry TTL.
  if (targetCreds.refresh && !options.skipRefresh) {
    try {
      const fresh = await refreshAntigravityToken(targetCreds.refresh);
      targetCreds = {
        ...targetCreds,
        access: fresh.access,
        refresh: fresh.refresh || targetCreds.refresh,
        expires: fresh.expires,
      };
      refreshedCredential = targetCreds;
    } catch {
      // Continue with current credentials if refresh fails
    }
  }

  const restartIfRunning = options.restartIfRunning !== false;
  const isRunning = await isAntigravityIdeRunning();
  let ideRestarted = false;

  if (isRunning && restartIfRunning) {
    await requestAntigravityQuit();
    // Wait up to 5 seconds for process exit
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (!(await isAntigravityIdeRunning())) break;
      await Bun.sleep(250);
    }
    // If still running after timeout, force terminate remaining PIDs
    if (await isAntigravityIdeRunning()) {
      const remainingPids = await findAntigravityIdePids();
      for (const pid of remainingPids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await Bun.sleep(400);
    }
  }

  // 2. Write to system credential store (macOS Keychain + credential-user-scope for agy --hub)
  await writeAntigravitySystemCredential({
    access: targetCreds.access,
    refresh: targetCreds.refresh,
    expires: targetCreds.expires,
    email: targetCreds.email,
  });

  // 3. Inject into state.vscdb SQLite database (for Electron Main process)
  const injectResult = injectAntigravityAccountToDb({
    access: targetCreds.access,
    refresh: targetCreds.refresh,
    expires: targetCreds.expires,
    email: targetCreds.email,
  });

  if (!injectResult.success) {
    return {
      success: false,
      ideInjected: false,
      ideRunning: isRunning,
      ideRestarted: false,
      ...(refreshedCredential ? { refreshedCredential } : {}),
      message: injectResult.error || "Failed to inject token into Antigravity IDE",
    };
  }

  // 4. Relaunch if it was running
  if (isRunning && restartIfRunning) {
    await Bun.sleep(300);
    launchAntigravityIde();
    ideRestarted = true;
  }

  return {
    success: true,
    ideInjected: true,
    ideRunning: isRunning,
    ideRestarted,
    ...(refreshedCredential ? { refreshedCredential } : {}),
    message: ideRestarted
      ? `已同步账号 ${targetCreds.email ?? ""} 到 Keychain 与状态库，并重启 Antigravity IDE`
      : `已同步账号 ${targetCreds.email ?? ""} 到 Keychain 与 Antigravity IDE 状态库`,
  };
}
