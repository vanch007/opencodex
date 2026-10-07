import type { OcxParsedRequest } from "../types";

const LEGACY_PROXY_PROGRESS = new Set([
  "OpenCodeX 状态：Gemini 正在调用工具执行下一步。",
  "OpenCodeX status: Gemini is calling a tool to continue the task.",
]);

/** Omit old proxy placeholders from Gemini replay without altering the client's history. */
export function stripGoogleToolProgressHistory(
  parsed: OcxParsedRequest,
  ccaGemini: boolean,
): OcxParsedRequest {
  if (!ccaGemini || !parsed._codexOwnThreadId || parsed._compactionRequest
    || parsed._memoryModelPhase || parsed._structuredOutput
    || parsed.options.textFormat) return parsed;

  let changed = false;
  const messages = parsed.context.messages.flatMap(message => {
    if (message.role !== "assistant" || message.phase === "final_answer") return [message];
    const content = message.content.filter(part => part.type !== "text"
      || !LEGACY_PROXY_PROGRESS.has(part.text.trim()));
    if (content.length === message.content.length) return [message];
    changed = true;
    return content.length ? [{ ...message, content }] : [];
  });
  return changed ? { ...parsed, context: { ...parsed.context, messages } } : parsed;
}
