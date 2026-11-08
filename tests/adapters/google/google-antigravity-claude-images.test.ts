import { beforeEach, describe, expect, test } from "bun:test";
import { createGoogleAdapter } from "../../../src/adapters/google";
import {
  enforceAntigravityClaudeImageLimits,
} from "../../../src/adapters/google-antigravity-images";
import { sniffImageDimensions } from "../../../src/adapters/anthropic-image-guard";
import { resetNormalizeStateForTests } from "../../../src/adapters/anthropic-image-normalize";
import type { OcxParsedRequest, OcxProviderConfig } from "../../../src/types";

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function makePngBuffer(width: number, height: number): Buffer {
  return Buffer.from(Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32be(13), 0x49, 0x48, 0x44, 0x52,
    ...u32be(width), ...u32be(height),
    8, 6, 0, 0, 0,
  ]));
}

function makeJpegBuffer(width: number, height: number): Buffer {
  return Buffer.from(Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x0b,
    8,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    3,
    1, 0x11, 0,
    0xff, 0xd9,
  ]));
}

// Polyfill Bun.Image for environments running Bun < 1.3.14
if (typeof (globalThis as unknown as { Bun?: { Image?: unknown } }).Bun?.Image !== "function") {
  (globalThis as unknown as { Bun: { Image: unknown } }).Bun.Image = class MockBunImage {
    private width: number;
    private height: number;
    constructor(input: Buffer | Uint8Array) {
      const b64 = Buffer.from(input).toString("base64");
      const dims = sniffImageDimensions(b64);
      this.width = dims?.width ?? 1;
      this.height = dims?.height ?? 1;
    }
    async metadata(): Promise<{ width: number; height: number }> {
      return { width: this.width, height: this.height };
    }
    resize(width: number, height: number): this {
      this.width = width;
      this.height = height;
      return this;
    }
    png(): { toBuffer(): Promise<Buffer> } {
      return { toBuffer: async () => makePngBuffer(this.width, this.height) };
    }
    jpeg(_opts?: { quality?: number }): { toBuffer(): Promise<Buffer> } {
      return { toBuffer: async () => makeJpegBuffer(this.width, this.height) };
    }
  };
}

async function realPngDataUrl(width: number, height: number): Promise<string> {
  const buf = await (new (globalThis as unknown as { Bun: { Image: new (b: Buffer) => { resize(w: number, h: number): { png(): { toBuffer(): Promise<Buffer> } } } } }).Bun.Image(Buffer.from(ONE_PX_PNG, "base64"))).resize(width, height).png().toBuffer();
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function pngHeaderBase64(width: number, height: number): string {
  return Buffer.from(Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32be(13), 0x49, 0x48, 0x44, 0x52,
    ...u32be(width), ...u32be(height),
    8, 6, 0, 0, 0,
  ])).toString("base64");
}

const ccaProvider: OcxProviderConfig = {
  adapter: "google",
  googleMode: "cloud-code-assist",
  baseUrl: "https://daily-cloudcode-pa.googleapis.com",
  apiKey: "test-cca-token",
  project: "proj-test",
} as OcxProviderConfig;

interface GeminiInlinePart {
  inline_data?: { mime_type: string; data: string };
  text?: string;
  functionResponse?: { name: string; response?: { result?: string }; parts?: GeminiInlinePart[] };
}

function extractImageInlineParts(contents: Array<{ parts?: GeminiInlinePart[] }>): Array<{ mime_type: string; data: string }> {
  const out: Array<{ mime_type: string; data: string }> = [];
  for (const turn of contents) {
    for (const part of turn.parts ?? []) {
      if (part.inline_data && part.inline_data.mime_type.startsWith("image/")) {
        out.push(part.inline_data);
      }
    }
  }
  return out;
}

beforeEach(() => resetNormalizeStateForTests());

describe("Claude-on-Antigravity many-image normalization and limits", () => {
  test("resizes >20 Retina (>3000px) screenshots across user and toolResult turns under the 2000px tier caps", async () => {
    const retinaA = await realPngDataUrl(3200, 2000);
    const retinaB = await realPngDataUrl(3456, 2234);
    const parsed = {
      modelId: "claude-sonnet-5-5",
      stream: false,
      options: {},
      context: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "inspect history" },
              ...Array.from({ length: 22 }, (_, idx) => ({
                type: "image" as const,
                imageUrl: idx % 2 === 0 ? retinaA : retinaB,
                detail: "high" as const,
              })),
            ],
            timestamp: 1,
          },
          {
            role: "assistant",
            content: [{ type: "toolCall", id: "call_shot_1", name: "screenshot", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "call_shot_1",
            toolName: "screenshot",
            content: [
              { type: "text", text: "captured" },
              { type: "image", imageUrl: retinaA, detail: "high" },
              { type: "image", imageUrl: retinaB, detail: "high" },
            ],
            isError: false,
          },
        ],
      },
    } as unknown as OcxParsedRequest;

    const built = await createGoogleAdapter(ccaProvider).buildRequest(parsed);
    const envelope = JSON.parse(built.body as string) as { request: { contents: Array<{ parts: GeminiInlinePart[] }> } };
    const images = extractImageInlineParts(envelope.request.contents);

    expect(images).toHaveLength(24);
    for (const img of images) {
      const dims = sniffImageDimensions(img.data);
      expect(dims).not.toBeNull();
      expect(Math.max(dims!.width, dims!.height)).toBeLessThanOrEqual(2000);
    }
    // Oldest images sit on tier 2 (<=700px), newest on tier 0 (<=2000px).
    const oldestDims = sniffImageDimensions(images[0]!.data)!;
    expect(Math.max(oldestDims.width, oldestDims.height)).toBeLessThanOrEqual(700);
    const newestDims = sniffImageDimensions(images[images.length - 1]!.data)!;
    expect(Math.max(newestDims.width, newestDims.height)).toBe(2000);
  });

  test(">100 oversized screenshots keep the newest 100 normalized images and textify surplus oldest", async () => {
    const retina = await realPngDataUrl(3200, 1800);
    const parsed = {
      modelId: "claude-opus-5-5",
      stream: false,
      options: {},
      context: {
        messages: [{
          role: "user",
          content: Array.from({ length: 104 }, () => ({
            type: "image" as const,
            imageUrl: retina,
          })),
          timestamp: 1,
        }],
      },
    } as unknown as OcxParsedRequest;

    const built = await createGoogleAdapter(ccaProvider).buildRequest(parsed);
    const envelope = JSON.parse(built.body as string) as { request: { contents: Array<{ parts: GeminiInlinePart[] }> } };
    const parts = envelope.request.contents[0]!.parts;
    const images = extractImageInlineParts(envelope.request.contents);

    expect(images).toHaveLength(100);
    for (let i = 0; i < 4; i++) {
      expect(parts[i]!.text).toContain("older screenshots were dropped");
    }
    for (const img of images) {
      const dims = sniffImageDimensions(img.data)!;
      expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(2000);
    }
  });

  test("preserves non-image inline_data (video and PDF documents) and leaves CCA Gemini untouched", async () => {
    const retina = await realPngDataUrl(3200, 2000);
    const claudeParsed = {
      modelId: "claude-sonnet-5-5",
      stream: false,
      options: {},
      context: {
        messages: [{
          role: "user",
          content: [
            { type: "video", videoUrl: "data:video/mp4;base64,dmlkZW8=" },
            { type: "document", mediaType: "application/pdf", data: "cGRm", text: "[pdf]" },
            { type: "image", imageUrl: retina },
          ],
          timestamp: 1,
        }],
      },
    } as unknown as OcxParsedRequest;

    const claudeBuilt = await createGoogleAdapter(ccaProvider).buildRequest(claudeParsed);
    const claudeParts = (JSON.parse(claudeBuilt.body as string) as { request: { contents: Array<{ parts: GeminiInlinePart[] }> } }).request.contents[0]!.parts;
    expect(claudeParts[0]).toEqual({ inline_data: { mime_type: "video/mp4", data: "dmlkZW8=" } });
    expect(claudeParts[1]).toEqual({ inline_data: { mime_type: "application/pdf", data: "cGRm" } });
    const normalizedDims = sniffImageDimensions(claudeParts[2]!.inline_data!.data)!;
    expect(Math.max(normalizedDims.width, normalizedDims.height)).toBe(2000);

    // CCA Gemini keeps raw inline_data without Anthropic image normalization.
    const geminiParsed = {
      ...claudeParsed,
      modelId: "gemini-4-argon",
      context: {
        messages: [{
          role: "user",
          content: [{ type: "image", imageUrl: "data:image/png;base64,bmV3" }],
          timestamp: 1,
        }],
      },
    } as unknown as OcxParsedRequest;
    const geminiBuilt = await createGoogleAdapter(ccaProvider).buildRequest(geminiParsed);
    const geminiParts = (JSON.parse(geminiBuilt.body as string) as { request: { contents: Array<{ parts: GeminiInlinePart[] }> } }).request.contents[0]!.parts;
    expect(geminiParts).toEqual([{ inline_data: { mime_type: "image/png", data: "bmV3" } }]);
  });

  test("honors imageTierBias and backstop limits on nested functionResponse parts", async () => {
    const medium = await realPngDataUrl(1500, 1000);
    const parsed = {
      modelId: "claude-sonnet-4-6",
      stream: false,
      options: {},
      context: {
        messages: [{
          role: "user",
          content: [{ type: "image", imageUrl: medium }],
          timestamp: 1,
        }],
      },
    } as unknown as OcxParsedRequest;
    const biased = await createGoogleAdapter(ccaProvider).buildRequest(parsed, {
      headers: new Headers(),
      imageTierBias: 1,
    });
    const biasedImg = extractImageInlineParts(
      (JSON.parse(biased.body as string) as { request: { contents: Array<{ parts: GeminiInlinePart[] }> } }).request.contents,
    )[0]!;
    expect(Math.max(sniffImageDimensions(biasedImg.data)!.width, sniffImageDimensions(biasedImg.data)!.height)).toBeLessThanOrEqual(1024);

    // Direct backstop check on nested functionResponse.parts (>8000px).
    const contents: Array<{ role: string; parts: GeminiInlinePart[] }> = [{
      role: "user",
      parts: [{
        functionResponse: {
          name: "shot",
          response: { result: "ok" },
          parts: [{ inline_data: { mime_type: "image/png", data: pngHeaderBase64(9000, 500) } }],
        },
      }],
    }];
    enforceAntigravityClaudeImageLimits(contents);
    expect(contents[0]!.parts[0]!.functionResponse!.parts).toBeUndefined();
    expect(contents[0]!.parts[0]!.functionResponse!.response!.result).toContain("8000px");
  });
});
