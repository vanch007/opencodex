/**
 * Regression suite for `#accounts` Google Antigravity add-account buttons.
 *
 * Covers both entry points on `Accounts` (top-right `+` menu and per-row empty
 * slot buttons), verifying they gate behind `OAuthTosWarningModal`, send
 * `acknowledgeAntigravityRisk: true`, surface server errors, and keep polling
 * multi-account `addAccount` logins until the flow actually finishes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Accounts from "../src/pages/Accounts";
import { LanguageProvider } from "../src/i18n/provider";

const API_BASE = "http://127.0.0.1:10100";
const GLOBALS = ["document", "window", "navigator", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;

type FetchCall = { url: string; method: string; body: Record<string, unknown> | null };
type StatusReply = {
  loggedIn?: boolean;
  status?: string;
  done?: boolean;
  error?: string;
  accounts?: Array<Record<string, unknown>>;
};
type LoginMockResult = { ok: boolean; status: number; body: Record<string, unknown> };

let previousGlobals: Record<(typeof GLOBALS)[number], PropertyDescriptor | undefined>;
let testWindow: Window;
let container: HTMLElement;
let root: Root | null = null;
let fetchCalls: FetchCall[] = [];
let openedUrls: string[] = [];
let antigravityAccounts: Array<Record<string, unknown>> = [];
let xaiAccounts: Array<Record<string, unknown>> = [];
let loginResult: LoginMockResult = {
  ok: true,
  status: 200,
  body: { url: "https://accounts.google.com/o/oauth2/v2/auth?mock=1", browserLaunch: "skipped" },
};
let statusQueue: StatusReply[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushUi(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
}

beforeEach(() => {
  previousGlobals = Object.fromEntries(
    GLOBALS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  ) as typeof previousGlobals;

  testWindow = new Window({ url: "http://localhost/#accounts" });
  Object.defineProperty(testWindow.navigator, "language", { configurable: true, value: "zh-CN" });
  Object.defineProperty(testWindow.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => {} },
  });
  testWindow.open = ((url?: string | URL) => {
    if (url) openedUrls.push(String(url));
    return null;
  }) as typeof testWindow.open;

  const dialogProto = (testWindow as unknown as {
    HTMLDialogElement: { prototype: { showModal?: () => void; close?: () => void } };
  }).HTMLDialogElement.prototype;
  dialogProto.showModal = function showModal() {
    (this as { open?: boolean }).open = true;
  };
  dialogProto.close = function close() {
    (this as { open?: boolean }).open = false;
  };

  fetchCalls = [];
  openedUrls = [];
  antigravityAccounts = [{ id: "ag-1", email: "user1@example.com", active: true, plan: "pro" }];
  xaiAccounts = [{ id: "xai-2", email: "user2@example.com", active: true, plan: "free" }];
  loginResult = {
    ok: true,
    status: 200,
    body: { url: "https://accounts.google.com/o/oauth2/v2/auth?mock=1", browserLaunch: "skipped" },
  };
  statusQueue = [{ loggedIn: true, status: "complete", done: true, accounts: antigravityAccounts }];

  const mockFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body) as Record<string, unknown>;
    }
    fetchCalls.push({ url: rawUrl, method, body });

    if (rawUrl.endsWith("/api/oauth/providers")) {
      return jsonResponse({ providers: ["google-antigravity", "xai"] });
    }
    if (rawUrl.includes("/api/oauth/accounts?provider=google-antigravity")) {
      return jsonResponse({ activeAccountId: "ag-1", accounts: antigravityAccounts });
    }
    if (rawUrl.includes("/api/oauth/accounts?provider=xai")) {
      return jsonResponse({ activeAccountId: "xai-2", accounts: xaiAccounts });
    }
    if (rawUrl.endsWith("/api/codex-auth/accounts")) {
      return jsonResponse({ accounts: [] });
    }
    if (rawUrl.endsWith("/api/settings")) {
      return jsonResponse({ maskEmails: false });
    }
    if (rawUrl.endsWith("/api/oauth/login")) {
      return jsonResponse(loginResult.body, loginResult.status);
    }
    if (rawUrl.includes("/api/oauth/status")) {
      const next = statusQueue.length > 1 ? statusQueue.shift()! : statusQueue[0] ?? { status: "pending", done: false };
      return jsonResponse(next);
    }
    if (rawUrl.endsWith("/api/oauth/login/cancel")) {
      return jsonResponse({ ok: true, cancelled: true });
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;

  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    fetch: { configurable: true, value: mockFetch },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });

  container = testWindow.document.createElement("div") as unknown as HTMLElement;
  testWindow.document.body.appendChild(container as never);
  root = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  for (const key of GLOBALS) {
    const descriptor = previousGlobals[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

async function mountAccounts(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LanguageProvider>
        <Accounts apiBase={API_BASE} pollIntervalMs={15} />
      </LanguageProvider>,
    );
  });
  await flushUi();
}

function loginCalls(): FetchCall[] {
  return fetchCalls.filter(c => c.url.endsWith("/api/oauth/login"));
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(btn => btn.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function acknowledgeAndContinueModal(): Promise<void> {
  const checkbox = container.querySelector('dialog input[type="checkbox"]') as HTMLInputElement;
  expect(checkbox).not.toBeNull();
  expect(checkbox.checked).toBe(false);
  await click(checkbox);
  const continueBtn = container.querySelector("dialog .modal-actions .btn-primary") as HTMLButtonElement;
  expect(continueBtn.disabled).toBe(false);
  await click(continueBtn);
}

describe("#accounts Antigravity add-account flow", () => {
  test("top-right + menu gates behind OAuthTosWarningModal and sends acknowledgeAntigravityRisk: true", async () => {
    await mountAccounts();

    const addTrigger = container.querySelector('button[data-tip="添加新账号"]') as HTMLButtonElement;
    expect(addTrigger).not.toBeNull();
    await click(addTrigger);

    const addAntigravityItem = findButtonByText("添加 Google Antigravity");
    expect(addAntigravityItem).toBeDefined();
    await click(addAntigravityItem!);

    // Must not start login until user acknowledges the risk dialog.
    expect(loginCalls()).toHaveLength(0);
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);

    await acknowledgeAndContinueModal();
    await flushUi(8);

    const calls = loginCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toMatchObject({
      provider: "google-antigravity",
      addAccount: true,
      acknowledgeAntigravityRisk: true,
    });
    expect(openedUrls).toEqual(["https://accounts.google.com/o/oauth2/v2/auth?mock=1"]);
  });

  test("row empty-slot + 添加 Antigravity button gates behind OAuthTosWarningModal and sends acknowledgement", async () => {
    await mountAccounts();

    const rowAddBtn = findButtonByText("+ 添加 Antigravity");
    expect(rowAddBtn).toBeDefined();
    await click(rowAddBtn!);

    expect(loginCalls()).toHaveLength(0);
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);

    await acknowledgeAndContinueModal();
    await flushUi(8);

    const calls = loginCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      provider: "google-antigravity",
      addAccount: true,
      acknowledgeAntigravityRisk: true,
    });
  });

  test("cancelling the Antigravity risk dialog makes no /api/oauth/login request", async () => {
    await mountAccounts();

    await click(container.querySelector('button[data-tip="添加新账号"]')!);
    await click(findButtonByText("添加 Google Antigravity")!);
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);

    const cancelBtn = container.querySelector("dialog .modal-actions .btn-ghost") as HTMLButtonElement;
    await click(cancelBtn);
    await flushUi(3);

    expect(container.querySelector("dialog")).toBeNull();
    expect(loginCalls()).toHaveLength(0);
  });

  test("surfaces server error banner instead of failing silently when /api/oauth/login rejects", async () => {
    loginResult = {
      ok: false,
      status: 403,
      body: {
        error: "Google Antigravity risk acknowledgment required",
        code: "antigravity_risk_not_acknowledged",
      },
    };
    await mountAccounts();

    await click(container.querySelector('button[data-tip="添加新账号"]')!);
    await click(findButtonByText("添加 Google Antigravity")!);
    await acknowledgeAndContinueModal();
    await flushUi(4);

    const alertBanner = container.querySelector('[role="alert"]');
    expect(alertBanner).not.toBeNull();
    expect(alertBanner!.textContent).toContain("Google Antigravity risk acknowledgment required");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  test("keeps polling when loggedIn is true from an existing account until pending flow completes", async () => {
    statusQueue = [
      { loggedIn: true, status: "pending", done: false, accounts: [...antigravityAccounts] },
      { loggedIn: true, status: "pending", done: false, accounts: [...antigravityAccounts] },
      {
        loggedIn: true,
        status: "complete",
        done: true,
        accounts: [
          ...antigravityAccounts,
          { id: "ag-new", email: "new@example.com", active: false, plan: "pro" },
        ],
      },
    ];
    await mountAccounts();

    const accountLoadsBefore = fetchCalls.filter(
      c => c.url.includes("/api/oauth/accounts?provider=google-antigravity"),
    ).length;

    await click(container.querySelector('button[data-tip="添加新账号"]')!);
    await click(findButtonByText("添加 Google Antigravity")!);
    await acknowledgeAndContinueModal();

    // After two pending poll cycles (loggedIn: true, status: "pending"), waiting banner stays visible.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(
      fetchCalls.filter(c => c.url.includes("/api/oauth/accounts?provider=google-antigravity")).length,
    ).toBe(accountLoadsBefore);

    // After statusQueue yields status: "complete", waiting banner clears and accounts reload.
    await flushUi(8);
    expect(container.querySelector('[role="status"]')).toBeNull();
    const statusCalls = fetchCalls.filter(c => c.url.includes("/api/oauth/status"));
    expect(statusCalls.length).toBeGreaterThanOrEqual(3);
    expect(
      fetchCalls.filter(c => c.url.includes("/api/oauth/accounts?provider=google-antigravity")).length,
    ).toBeGreaterThan(accountLoadsBefore);
  });
});
