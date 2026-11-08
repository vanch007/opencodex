/**
 * Claude-on-Antigravity image normalization and backstop limits.
 *
 * Google Cloud Code Assist translates Gemini contents (inline_data / inlineData)
 * into Vertex Anthropic messages when serving Claude models. Without Anthropic's
 * per-request image normalization and many-image / 100-image / byte-budget guards,
 * sessions that accumulate >20 Retina screenshots fail upstream with HTTP 400:
 * "At least one of the image dimensions exceed max allowed size for many-image requests".
 *
 * Only image/* inline blobs are touched; inline video (video/*) and document
 * (application/pdf, etc.) parts share inline_data on the Gemini wire and pass through.
 */

import {
  enforceImageTargetLimits,
  MAX_IMAGES_PER_REQUEST,
} from "./anthropic-image-guard";
import {
  normalizeImageTargets,
  type NormalizeOptions,
  type NormalizeTarget,
} from "./anthropic-image-normalize";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readInlineImagePart(part: unknown): { mediaType: string; base64: string | null } | null {
  if (!isRecord(part)) return null;
  const inline = isRecord(part.inline_data)
    ? part.inline_data
    : isRecord(part.inlineData)
      ? part.inlineData
      : null;
  if (!inline) return null;
  const rawMime = typeof inline.mime_type === "string"
    ? inline.mime_type
    : typeof inline.mimeType === "string"
      ? inline.mimeType
      : "";
  const mediaType = rawMime.trim().toLowerCase();
  if (!mediaType.startsWith("image/")) return null;
  return {
    mediaType,
    base64: typeof inline.data === "string" ? inline.data : null,
  };
}

function appendFunctionResponseNote(functionResponse: Record<string, unknown>, note: string): void {
  const response = isRecord(functionResponse.response) ? functionResponse.response : null;
  if (!response) return;
  const current = typeof response.result === "string" ? response.result : "";
  response.result = current ? current + "\n" + note : note;
}

/** Collect Gemini image inline_data handles in wire order (oldest first). */
export function collectAntigravityClaudeImageTargets(
  contents: unknown[],
  mode: "normalize" | "enforce" = "enforce",
): NormalizeTarget[] {
  if (!Array.isArray(contents)) return [];
  const targets: NormalizeTarget[] = [];
  const preserveOnNormalizeDrop = mode === "normalize";

  for (const rawContent of contents) {
    if (!isRecord(rawContent) || !Array.isArray(rawContent.parts)) continue;
    const parts = rawContent.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const img = readInlineImagePart(part);
      if (img) {
        const idx = i;
        targets.push({
          base64: img.base64,
          mediaType: img.mediaType,
          replace: (data: string, mediaType: string) => {
            parts[idx] = { inline_data: { mime_type: mediaType, data } };
          },
          drop: (note: string) => {
            if (preserveOnNormalizeDrop) return;
            parts[idx] = { text: note };
          },
          ...(preserveOnNormalizeDrop ? { retainsBytesOnDrop: true } : {}),
        });
        continue;
      }

      if (!isRecord(part) || !isRecord(part.functionResponse) || !Array.isArray(part.functionResponse.parts)) {
        continue;
      }
      const functionResponse = part.functionResponse;
      const nestedParts = functionResponse.parts as unknown[];
      for (const nestedPart of [...nestedParts]) {
        const nestedImg = readInlineImagePart(nestedPart);
        if (!nestedImg) continue;
        let currentRef: unknown = nestedPart;
        targets.push({
          base64: nestedImg.base64,
          mediaType: nestedImg.mediaType,
          replace: (data: string, mediaType: string) => {
            const pos = nestedParts.indexOf(currentRef);
            if (pos === -1) return;
            const replacement = { inline_data: { mime_type: mediaType, data } };
            nestedParts[pos] = replacement;
            currentRef = replacement;
          },
          drop: (note: string) => {
            if (preserveOnNormalizeDrop) return;
            const pos = nestedParts.indexOf(currentRef);
            if (pos !== -1) nestedParts.splice(pos, 1);
            if (nestedParts.length === 0) delete functionResponse.parts;
            appendFunctionResponseNote(functionResponse, note);
          },
          ...(preserveOnNormalizeDrop ? { retainsBytesOnDrop: true } : {}),
        });
      }
    }
  }

  return targets;
}

/** Resize/re-encode inline images in compiled Gemini contents for Claude-on-Antigravity. */
export async function normalizeAntigravityClaudeImages(
  contents: unknown[],
  options: NormalizeOptions = {},
): Promise<void> {
  const targets = collectAntigravityClaudeImageTargets(contents, "normalize");
  if (targets.length === 0) return;
  await normalizeImageTargets(targets, {
    ...options,
    processLimit: MAX_IMAGES_PER_REQUEST,
    overflowAction: "none",
  });
}

/** Deterministic Anthropic image-limit backstop over compiled Gemini contents. */
export function enforceAntigravityClaudeImageLimits(contents: unknown[]): void {
  const targets = collectAntigravityClaudeImageTargets(contents, "enforce");
  if (targets.length === 0) return;
  enforceImageTargetLimits(targets);
}
