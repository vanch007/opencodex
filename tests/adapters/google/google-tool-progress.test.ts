import { describe, expect, test } from "bun:test";
import { createGoogleAdapter } from "../../../src/adapters/google";
import { bridgeToResponsesSSE, buildResponseJSON } from "../../../src/bridge";
import { parseRequest } from "../../../src/responses/parser";
import type { AdapterEvent, OcxParsedRequest, OcxProviderConfig } from "../../../src/types";
import { withTestTranslatorBudget } from "../../helpers/translator-budget";

const provider: OcxProviderConfig = {
  adapter: "google", googleMode: "cloud-code-assist",
  baseUrl: "https://daily-cloudcode-pa.googleapis.com", apiKey: "fixture-key",
  project: "fixture-project", showThinkingSummary: true,
};
const signature = "CiQAx-progress-fixture-signature-0123456789abcdef";
const call = { functionCall: { name: "lookup", args: { query: "fixture-value" } }, thoughtSignature: signature };
const legacyStatuses = [
  "OpenCodeX 状态：Gemini 正在调用工具执行下一步。",
  "OpenCodeX status: Gemini is calling a tool to continue the task.",
];

function request(stream: boolean): OcxParsedRequest {
  const parsed = parseRequest({
    model: "gemini-3.8-flash", stream,
    input: [{ role: "user", content: "请检查后继续处理。" }],
    tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }],
    reasoning: { effort: "max", summary: "detailed" },
  });
  parsed._codexOwnThreadId = "fixture-thread";
  return parsed;
}

async function collect(
  parsed: OcxParsedRequest,
  frames: unknown[][],
  config = provider,
  adapter = withTestTranslatorBudget(createGoogleAdapter(config)),
): Promise<AdapterEvent[]> {
  await adapter.buildRequest(parsed);
  const payload = (parts: unknown[], terminal: boolean) => {
    const body = { candidates: [{ content: { parts }, ...(terminal ? { finishReason: "STOP" } : {}) }] };
    return config.googleMode === "cloud-code-assist" ? { response: body } : body;
  };
  if (!parsed.stream) return adapter.parseResponse!(Response.json(payload(frames.flat(), true)));
  const wire = frames.map((parts, i) => `data: ${JSON.stringify(payload(parts, i === frames.length - 1))}\n\n`).join("");
  const events: AdapterEvent[] = [];
  for await (const event of adapter.parseStream(new Response(wire))) events.push(event);
  return events;
}

function progress(events: AdapterEvent[]) {
  return events.filter(event => event.type === "text_delta" && event.phase === "commentary" && event.text.startsWith("OpenCodeX"));
}

function continueAfterTool(parsed: OcxParsedRequest, events: AdapterEvent[]): OcxParsedRequest {
  const body = parsed._rawBody as { input: unknown[] };
  const output = buildResponseJSON(events, parsed.modelId).output as Array<Record<string, unknown>>;
  const tool = output.find(item => item.type === "function_call")!;
  const next = parseRequest({
    ...body,
    input: [...body.input, ...output, { type: "function_call_output", call_id: tool.call_id, output: "fixture-result" }],
  });
  next._codexOwnThreadId = parsed._codexOwnThreadId;
  return next;
}

describe("Gemini Codex tool-only progress", () => {
  for (const stream of [false, true]) {
    test(`silent signed calls do not fabricate assistant commentary (stream=${stream})`, async () => {
      const parsed = request(stream);
      const events = await collect(parsed, [[{ thought: true, thoughtSignature: signature }], [call]]);
      expect(progress(events)).toHaveLength(0);
      expect(events[0]?.type).toBe("tool_call_start");
      const tool = events.find(event => event.type === "tool_call_start");
      expect(tool?.type === "tool_call_start" && tool.providerMetadata?.google?.thoughtSignature).toBe(signature);
      expect(events.find(event => event.type === "tool_call_delta")).toEqual({ type: "tool_call_delta", arguments: JSON.stringify(call.functionCall.args) });
      expect(events.at(-1)?.type).toBe("done");

      let output: Record<string, unknown>;
      if (stream) {
        async function* replay() { yield* events; }
        const sse = await new Response(bridgeToResponsesSSE(replay(), parsed.modelId)).text();
        const frames = sse.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
        expect(frames.some(frame => frame.type === "response.output_text.delta")).toBe(false);
        output = frames.find(frame => frame.type === "response.completed").response;
      } else output = buildResponseJSON(events, parsed.modelId);
      const items = output.output as Array<Record<string, unknown>>;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: "function_call", name: "lookup", arguments: JSON.stringify(call.functionCall.args) });
    });

    test(`a parallel batch does not invent progress lines (stream=${stream})`, async () => {
      const events = await collect(request(stream), [[call], [call], [call]]);
      expect(progress(events)).toHaveLength(0);
      expect(events.filter(event => event.type === "tool_call_start")).toHaveLength(3);
    });

    test(`serial tool continuations do not repeat proxy status (stream=${stream})`, async () => {
      let parsed = request(stream);
      let events = await collect(parsed, [[call]]);
      expect(progress(events)).toHaveLength(0);
      for (let step = 0; step < 3; step++) {
        parsed = continueAfterTool(parsed, events);
        events = await collect(parsed, [[call]]);
        expect(progress(events)).toHaveLength(0);
        expect(events.filter(event => event.type === "tool_call_start")).toHaveLength(1);
      }
      const final = await collect(continueAfterTool(parsed, events), [[{ text: "Complete." }]]);
      expect(final).toEqual([{ type: "text_delta", text: "Complete." }, { type: "done", usage: undefined }]);
    });

    test(`a fresh user request does not restore synthetic status (stream=${stream})`, async () => {
      const parsed = request(stream);
      const next = continueAfterTool(parsed, await collect(parsed, [[call]]));
      const body = next._rawBody as { input: unknown[] };
      const fresh = parseRequest({ ...body, input: [...body.input, { role: "user", content: "请继续检查另一个文件。" }] });
      fresh._codexOwnThreadId = parsed._codexOwnThreadId;
      expect(progress(await collect(fresh, [[call]]))).toHaveLength(0);
    });

    test(`existing commentary in the current user turn suppresses status (stream=${stream})`, async () => {
      const parsed = request(stream);
      parsed.context.messages.push({
        role: "assistant", phase: "commentary",
        content: [{ type: "text", text: "Checking the implementation." }], timestamp: 0,
      });
      expect(progress(await collect(parsed, [[call]]))).toHaveLength(0);
    });

    test(`a tool-only continuation without replayed status stays quiet (stream=${stream})`, async () => {
      const parsed = parseRequest({
        ...(request(stream)._rawBody as object), previous_response_id: "resp_fixture",
        input: [{ type: "function_call_output", call_id: "call_fixture", output: "fixture-result" }],
      });
      parsed._codexOwnThreadId = "fixture-thread";
      expect(progress(await collect(parsed, [[call]]))).toHaveLength(0);
    });

    test(`real progress still passes through a tool continuation (stream=${stream})`, async () => {
      const parsed = request(stream);
      const next = continueAfterTool(parsed, await collect(parsed, [[call]]));
      const events = await collect(next, [[{ text: "Found the cause; checking the related file." }], [call]]);
      expect(progress(events)).toHaveLength(0);
      expect(events[0]).toEqual({ type: "text_delta", text: "Found the cause; checking the related file." });
    });

    for (const textPart of [{ text: "Checking the file." }, { thought: true, text: "Provider summary." }]) {
      test(`provider text is not duplicated (${JSON.stringify(textPart)}, stream=${stream})`, async () => {
        const events = await collect(request(stream), [[textPart], [call]]);
        expect(progress(events)).toHaveLength(0);
        expect(events[0]).toEqual("thought" in textPart
          ? { type: "thinking_delta", thinking: textPart.text }
          : { type: "text_delta", text: textPart.text });
      });
    }

    test(`real summaries and execution commentary reach Codex's native channels (stream=${stream})`, async () => {
      const parsed = request(stream);
      const events = await collect(parsed, [
        [{ thought: true, text: "Checking which setting controls the display." }],
        [{ text: "Checking runner.py before testing." }], [call],
      ]);
      let output: Record<string, unknown>;
      if (stream) {
        async function* replay() { yield* events; }
        const wire = await new Response(bridgeToResponsesSSE(replay(), parsed.modelId)).text();
        const frames = wire.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
        expect(frames.find(frame => frame.type === "response.reasoning_summary_text.delta").delta)
          .toBe("Checking which setting controls the display.");
        expect(frames.some(frame => frame.type === "response.reasoning_text.delta")).toBe(false);
        output = frames.find(frame => frame.type === "response.completed").response;
      } else output = buildResponseJSON(events, parsed.modelId);
      expect(output.output).toMatchObject([
        { type: "reasoning", summary: [{ type: "summary_text", text: "Checking which setting controls the display." }] },
        { type: "message", phase: "commentary", content: [{ type: "output_text", text: "Checking runner.py before testing." }] },
        { type: "function_call", name: "lookup" },
      ]);
    });

    test(`hidden summaries neither leak nor fabricate progress (stream=${stream})`, async () => {
      const parsed = request(stream);
      parsed.options.hideThinkingSummary = true;
      const events = await collect(parsed, [[{ thought: true, text: "private-fixture" }], [call]]);
      expect(progress(events)).toHaveLength(0);
      const output = buildResponseJSON(events, parsed.modelId, { hideThinkingSummary: true });
      expect(JSON.stringify(output)).not.toContain("private-fixture");
      expect(JSON.stringify(output)).not.toContain("OpenCodeX 状态");
    });

    test(`whitespace does not count as a visible message (stream=${stream})`, async () => {
      const events = await collect(request(stream), [[{ text: " \n\t" }], [call]]);
      expect(progress(events)).toHaveLength(0);
    });

    test(`ordinary final text stays unchanged (stream=${stream})`, async () => {
      const events = await collect(request(stream), [[{ text: "Complete." }]]);
      expect(events).toEqual([{ type: "text_delta", text: "Complete." }, { type: "done", usage: undefined }]);
    });

    test(`invalid calls remain fail-closed without invented progress (stream=${stream})`, async () => {
      const events = await collect(request(stream), [[{ functionCall: { name: "", args: {} } }]]);
      expect(events[0]?.type).toBe("error");
      expect(progress(events)).toHaveLength(0);
      expect(events.some(event => event.type === "tool_call_start")).toBe(false);
    });

    for (const excluded of ["no-codex-thread", "compaction", "structured", "memory", "claude", "direct"] as const) {
      test(`does not inject into ${excluded} (stream=${stream})`, async () => {
        const parsed = request(stream);
        let config = provider;
        if (excluded === "no-codex-thread") delete parsed._codexOwnThreadId;
        if (excluded === "compaction") parsed._compactionRequest = true;
        if (excluded === "structured") parsed.options.textFormat = { type: "json_object" };
        if (excluded === "memory") parsed._memoryModelPhase = "extract";
        if (excluded === "claude") parsed.modelId = "claude-sonnet-4-6";
        if (excluded === "direct") config = { ...provider, googleMode: "ai-studio", baseUrl: "https://generativelanguage.googleapis.com" };
        expect(progress(await collect(parsed, [[call]], config))).toHaveLength(0);
      });
    }
  }

  test("a reused adapter never invents English status", async () => {
    const parsed = request(false);
    parsed.context.messages = [{ role: "user", content: "Continue checking the file.", timestamp: 0 }];
    const adapter = withTestTranslatorBudget(createGoogleAdapter(provider));
    const first = await collect(parsed, [[call]], provider, adapter);
    expect(progress(first)).toHaveLength(0);
    delete parsed._codexOwnThreadId;
    expect(progress(await collect(parsed, [[call]], provider, adapter))).toHaveLength(0);
  });

  for (const stream of [false, true]) for (const status of legacyStatuses) {
    test(`legacy commentary is not taught back to Gemini (${status.slice(0, 16)}, stream=${stream})`, async () => {
      const parsed = request(stream);
      parsed.context.messages.push({
        role: "assistant", phase: "commentary", timestamp: 0,
        content: [{ type: "text", text: ` \n${status}\n` }, {
          type: "toolCall", id: "call_fixture", name: "lookup", arguments: call.functionCall.args,
          providerMetadata: { google: { thoughtSignature: signature } },
        }],
      }, { role: "toolResult", toolCallId: "call_fixture", toolName: "lookup", content: "fixture-result", isError: false, timestamp: 0 });
      const before = JSON.stringify(parsed);
      const adapter = createGoogleAdapter(provider);
      const wire = JSON.parse((await adapter.buildRequest(parsed)).body);
      const turns = wire.request.contents;
      expect(JSON.stringify(turns)).not.toContain(status);
      expect(turns[1].parts[0]).toMatchObject({ functionCall: { name: "lookup", args: call.functionCall.args }, thoughtSignature: signature });
      expect(turns[2].parts[0].functionResponse.name).toBe("lookup");
      expect(JSON.stringify(turns[2])).toContain("fixture-result");
      expect(wire.request.generationConfig.thinkingConfig.includeThoughts).toBe(true);
      expect(JSON.stringify(parsed)).toBe(before);
    });
  }

  test("text-only legacy messages are removed but genuine commentary, quotes, users and finals survive", async () => {
    const parsed = request(false);
    const status = legacyStatuses[0];
    parsed.context.messages.push(
      { role: "assistant", phase: "commentary", timestamp: 0, content: [{ type: "text", text: status }] },
      { role: "assistant", timestamp: 0, content: [{ type: "text", text: legacyStatuses[1] }] },
      { role: "assistant", phase: "commentary", timestamp: 0, content: [{ type: "text", text: status }, { type: "text", text: "Checking runner.py before testing." }] },
      { role: "assistant", phase: "commentary", timestamp: 0, content: [{ type: "text", text: `The reported bug says: ${status}` }] },
      { role: "assistant", phase: "final_answer", timestamp: 0, content: [{ type: "text", text: status }] },
      { role: "user", timestamp: 0, content: status },
    );
    const wire = JSON.parse((await createGoogleAdapter(provider).buildRequest(parsed)).body);
    const turns = wire.request.contents;
    expect(turns).toHaveLength(5);
    expect(turns[1].parts).toEqual([{ text: "Checking runner.py before testing." }]);
    expect(turns[2].parts[0].text).toBe(`The reported bug says: ${status}`);
    expect(turns[3].parts[0].text).toBe(status);
    expect(turns[4].parts[0].text).toBe(status);
  });

  for (const excluded of ["no-codex-thread", "claude", "direct", "vertex", "compaction", "structured", "image", "memory"] as const) {
    test(`history cleanup leaves ${excluded} untouched`, async () => {
      const parsed = request(false);
      parsed.context.messages.push({ role: "assistant", phase: "commentary", timestamp: 0, content: [{ type: "text", text: legacyStatuses[0] }] });
      let config = provider;
      if (excluded === "no-codex-thread") delete parsed._codexOwnThreadId;
      if (excluded === "claude") parsed.modelId = "claude-sonnet-4-6";
      if (excluded === "direct") config = { ...provider, googleMode: "ai-studio", baseUrl: "https://generativelanguage.googleapis.com" };
      if (excluded === "vertex") config = { ...provider, googleMode: "vertex", location: "global" };
      if (excluded === "compaction") parsed._compactionRequest = true;
      if (excluded === "structured") parsed.options.textFormat = { type: "json_object" };
      if (excluded === "image") parsed.modelId = "gemini-3-pro-image-preview";
      if (excluded === "memory") parsed._memoryModelPhase = "extract";
      const wire = JSON.parse((await createGoogleAdapter(config).buildRequest(parsed)).body);
      expect(JSON.stringify((wire.request ?? wire).contents)).toContain(legacyStatuses[0]);
    });
  }
});
