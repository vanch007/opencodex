import { afterEach, expect, test } from "bun:test";
// Kept separate from the capped catalog suite; verifies the same persisted summary contract.
import { buildCatalogEntries, gatherRoutedModels } from "../../src/codex/catalog";
import { clearModelCache } from "../../src/codex/model-cache";
import type { OcxProviderConfig } from "../../src/types";
import { withStubbedProviderFetch } from "../helpers/catalog-provider-fetch";

afterEach(() => clearModelCache());

function nativeTemplate(): Record<string, unknown> {
  return {
    slug: "gpt-5.5",
    display_name: "gpt-5.5",
    description: "Native GPT model",
    priority: 1,
    visibility: "list",
    base_instructions: "You are Codex, a coding agent based on GPT-5.\nUse tools carefully.",
    model_messages: {
      instructions_template: "You are Codex, a coding agent based on GPT-5.",
    },
    tool_mode: "code",
    multi_agent_version: "v2",
    use_responses_lite: true,
    supports_websockets: true,
    web_search_tool_type: "text_and_image",
    supports_search_tool: true,
    additional_speed_tiers: [{ id: "priority" }],
    service_tier: "fast",
    service_tiers: [{ id: "fast" }],
    default_service_tier: "priority",
    supported_reasoning_levels: [
      { effort: "low", description: "native low" },
      { effort: "medium", description: "native medium" },
      { effort: "high", description: "native high" },
      { effort: "xhigh", description: "native xhigh" },
    ],
  };
}

test("Google Antigravity Gemini summaries stay visible after catalog sync", async () => {
  const provider: OcxProviderConfig = {
    adapter: "google", baseUrl: "https://daily-cloudcode-pa.googleapis.com",
    authMode: "oauth", googleMode: "cloud-code-assist", liveModels: false,
    models: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.1-pro"],
    modelSupportsReasoningSummaries: { "gemini-3.7-flash": false },
  };
  const models = await gatherRoutedModels(withStubbedProviderFetch({ providers: { "google-antigravity": provider } }));
  const entries = buildCatalogEntries(nativeTemplate(), [], models);
  const summarySupport = (id: string) => entries.find(entry =>
    entry.slug === `google-antigravity/${id}`)?.supports_reasoning_summaries;

  expect(summarySupport("gemini-3.8-flash")).toBe(true);
  expect(summarySupport("gemini-3.7-flash")).toBe(false); // Explicit user opt-out wins.
  expect(summarySupport("gemini-3.1-pro")).toBe(true);
});
