import { OpenRouterError } from "@openrouter/sdk/models/errors";

/**
 * Upstream refusals that mean this turn cannot carry a tool list at all, so
 * dropping the tools is the only way it can succeed. Two shapes reach us:
 *
 * 1. OpenRouter's own routing. It picks an endpoint only if the endpoint can
 *    serve every parameter in the request, so a `tools` list narrows the
 *    candidates and the turn dies at the "Filter by Tool Compatibility" step
 *    when none survive — `404 "No endpoints found that support tool use. Try
 *    disabling \"bash\"."` Slugs like `thedrummer/cydonia-24b-v4.1` list no
 *    `tools` in `supported_parameters` and always land here.
 *
 * 2. An endpoint that advertises `tools` and cannot actually serve them, which
 *    routing therefore accepts. `thedrummer/unslopnemo-12b` is served by a
 *    vLLM process started without tool calling, and it answers `400 "auto"
 *    tool choice requires --enable-auto-tool-choice and --tool-call-parser to
 *    be set`, wrapped by OpenRouter as "Provider returned error". Omitting
 *    `tool_choice` does not help — vLLM still defaults to auto — and
 *    `provider: { require_parameters: true }` still routes there, because the
 *    endpoint's advertised parameters are what routing trusts.
 *
 * Matched against the response body text rather than the status, so unrelated
 * 404s (unknown slug, no allowed providers) and 400s (context length, a
 * malformed tool schema) keep their own error path. The vLLM flag names carry
 * no quotes or backslashes, so they survive JSON escaping intact however deep
 * OpenRouter nests the provider body inside `metadata.raw` — no unwrapping
 * needed.
 */
const TOOL_SUPPORT_REJECTIONS = [
  "no endpoints found that support tool use",
  "--enable-auto-tool-choice",
  "--tool-call-parser",
] as const;

export function isOpenRouterToolSupportRejection(error: unknown): boolean {
  if (!(error instanceof OpenRouterError) || typeof error.body !== "string") {
    return false;
  }

  const body = error.body.toLowerCase();
  return TOOL_SUPPORT_REJECTIONS.some((marker) => body.includes(marker));
}

/**
 * Appended to the system prompt on the retry. The prompt still describes bash,
 * read_file and the rest, so without this line a model that never received the
 * tool list answers as though it had run them.
 */
export const OPENROUTER_TOOLS_UNAVAILABLE_GUIDANCE =
  "Tools are unavailable on this turn: the active OpenRouter model has no tool-calling support, so the tools described above were not sent with this request and calling them is impossible. Do not emit tool-call syntax, and never say or imply that you ran a command, read or wrote a file, fetched a URL, or searched anything. Answer from the conversation alone, and if the request genuinely needs a tool, say plainly that this model cannot run tools and name what you would have needed.";
