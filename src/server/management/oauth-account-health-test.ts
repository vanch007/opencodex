import type { OcxConfig, OcxParsedRequest } from "../../types";
import { jsonResponse } from "../auth-cors";
import { readManagementJsonBody } from "./body";
import { getAccountCredentialWithStatus } from "../../oauth/store";
import { getValidAccessTokenForAccount } from "../../oauth";
import { createGoogleAdapter } from "../../adapters/google";
import { clearGenericFailoverHealthForAccount } from "../../oauth/generic-account-failover";
import { createTranslatorBudget } from "../../lib/translator-budget";

export interface AccountHealthTestResult {
  ok: boolean;
  status: number;
  durationMs: number;
  model: string;
  errorCode?: string;
  message: string;
  accountEmail?: string;
  paused?: boolean;
}

export async function handleOAuthAccountHealthTest(
  req: Request,
  config: OcxConfig,
): Promise<Response> {
  const body = await readManagementJsonBody<{
    provider?: unknown;
    accountId?: unknown;
    model?: unknown;
  }>(req);

  const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  const requestedModel = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  if (!provider || !accountId) {
    return jsonResponse({ error: "provider and accountId are required" }, 400);
  }

  const row = getAccountCredentialWithStatus(provider, accountId);
  if (!row) {
    return jsonResponse({ error: "account not found" }, 404);
  }

  const email = row.credential.email || "";

  // 1. Google Antigravity Real Model Probe
  if (provider === "google-antigravity") {
    const testModel = requestedModel || "gemini-3.8-flash";
    const startTime = Date.now();

    try {
      const token = await getValidAccessTokenForAccount("google-antigravity", accountId);
      if (!token) {
        return jsonResponse({
          ok: false,
          status: 401,
          durationMs: Date.now() - startTime,
          model: testModel,
          errorCode: "reauth_required",
          message: "获取 Token 失败，账号可能需要重新登录授权",
          accountEmail: email,
        } satisfies AccountHealthTestResult, 200);
      }

      const project = row.credential.projectId || "aicode-consumers";
      const baseUrl = config.providers["google-antigravity"]?.baseUrl || "https://daily-cloudcode-pa.googleapis.com";

      const adapter = createGoogleAdapter({
        adapter: "google",
        googleMode: "cloud-code-assist",
        baseUrl,
        apiKey: token,
        project,
      });

      const incomingMeta = {
        headers: new Headers(),
        translatorBudget: createTranslatorBudget(),
      };

      const parsedRequest: OcxParsedRequest = {
        modelId: testModel,
        stream: false,
        options: {},
        context: {
          messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
        },
      };

      const built = await adapter.buildRequest(parsedRequest, incomingMeta);

      const res = await fetch(built.url, {
        method: built.method,
        headers: built.headers,
        body: built.body,
        signal: AbortSignal.timeout(15_000),
      });

      const durationMs = Date.now() - startTime;

      if (res.ok) {
        // Clear any prior cooldown/rate error on verified healthy status
        clearGenericFailoverHealthForAccount("google-antigravity", accountId);
        return jsonResponse({
          ok: true,
          status: res.status,
          durationMs,
          model: testModel,
          message: `模型真实调用正常 (${durationMs}ms)`,
          accountEmail: email,
        } satisfies AccountHealthTestResult, 200);
      }

      let errorCode = "upstream_error";
      let message = `上游返回 HTTP ${res.status}`;
      let autoPaused = false;

      if (res.status === 404) {
        errorCode = "not_found";
        message = `该账号不支持模型 ${testModel} (404 Not Found)`;
      } else if (res.status === 403 || res.status === 401) {
        errorCode = "permission_denied";
        const errText = (await res.text().catch(() => "")).toLowerCase();
        const isTos = errText.includes("terms of service") || errText.includes("tos_violation") || errText.includes("disabled");
        message = isTos ? "账号已被 Google 封禁/停用 (TOS 违规 403)" : `账号权限被拒绝 (${res.status})，已失效`;
        try {
          const { setAccountPaused } = await import("../../oauth/store");
          await setAccountPaused(provider, accountId, true);
          autoPaused = true;
        } catch {
          // ignore pause failure
        }
      } else if (res.status === 429) {
        errorCode = "rate_limit_exceeded";
        message = `上游模型配额已耗尽 (429 Rate Limit)`;
      } else if (res.status >= 500) {
        errorCode = "upstream_server_error";
        message = `上游服务暂时不可用 (${res.status})`;
      }

      return jsonResponse({
        ok: false,
        status: res.status,
        durationMs,
        model: testModel,
        errorCode,
        message,
        accountEmail: email,
        ...(autoPaused ? { paused: true } : {}),
      } satisfies AccountHealthTestResult, 200);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.message.includes("timed out"));
      return jsonResponse({
        ok: false,
        status: isTimeout ? 504 : 500,
        durationMs,
        model: testModel,
        errorCode: isTimeout ? "timeout" : "internal_error",
        message: isTimeout ? "模型调用超时 (>15s)" : (error instanceof Error ? error.message : "未知测试异常"),
        accountEmail: email,
      } satisfies AccountHealthTestResult, 200);
    }
  }

  // 2. Fallback for other providers: probe access token
  try {
    const token = await getValidAccessTokenForAccount(provider, accountId);
    return jsonResponse({
      ok: Boolean(token),
      status: token ? 200 : 401,
      durationMs: 0,
      model: "token-check",
      message: token ? "Token 校验正常" : "Token 无效",
      accountEmail: email,
    } satisfies AccountHealthTestResult, 200);
  } catch (err) {
    return jsonResponse({
      ok: false,
      status: 500,
      durationMs: 0,
      model: "token-check",
      message: err instanceof Error ? err.message : "健康检测失败",
      accountEmail: email,
    } satisfies AccountHealthTestResult, 200);
  }
}
