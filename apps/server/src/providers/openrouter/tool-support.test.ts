import { describe, expect, test } from "bun:test";
import { OpenRouterError } from "@openrouter/sdk/models/errors";
import {
  isOpenRouterToolSupportRejection,
  OPENROUTER_TOOLS_UNAVAILABLE_GUIDANCE,
} from "./tool-support";

function openRouterError(status: number, body: string): OpenRouterError {
  const request = new Request("https://openrouter.ai/api/v1/chat/completions");
  const response = new Response(body, { status });

  return new OpenRouterError(`API error occurred: Status ${status}`, {
    body,
    request,
    response,
  });
}

const TOOL_REJECTION_BODY = JSON.stringify({
  error: {
    code: 404,
    message:
      'No endpoints found that support tool use. Try disabling "bash". To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection',
    metadata: {
      failed_routing_step: "Filter by Tool Compatibility",
      routing_funnel: [{ endpoint_count: 1, step: "Initial Endpoints" }],
    },
  },
});

/**
 * Shaped like the real OpenRouter body for `thedrummer/unslopnemo-12b`: the
 * endpoint advertises `tools`, so routing accepts the turn, and its vLLM
 * process then rejects it because tool calling was never enabled at startup.
 * Built by nesting the way OpenRouter nests it — a provider error string
 * inside `metadata.raw` — so the escaping here matches production instead of
 * being hand-written. The vLLM flag names survive that escaping, which is why
 * matching the body text works without unwrapping it.
 */
const VLLM_TOOL_CHOICE_REJECTION_BODY = JSON.stringify({
  error: {
    code: 400,
    message: "Provider returned error",
    metadata: {
      is_byok: false,
      provider_error_code: "400",
      provider_name: "NextBit",
      raw: JSON.stringify({
        error: {
          code: 400,
          message: JSON.stringify({
            error: {
              code: 400,
              message:
                '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set',
              param: null,
              type: "BadRequestError",
            },
          }),
          param: null,
          type: "invalid_request_error",
        },
      }),
    },
  },
});

describe("isOpenRouterToolSupportRejection", () => {
  test("detects the tool-compatibility routing rejection", () => {
    expect(
      isOpenRouterToolSupportRejection(
        openRouterError(404, TOOL_REJECTION_BODY)
      )
    ).toBe(true);
  });

  test("ignores an unrelated 404", () => {
    expect(
      isOpenRouterToolSupportRejection(
        openRouterError(
          404,
          JSON.stringify({
            error: {
              code: 404,
              message:
                "No allowed providers are available for the selected model.",
            },
          })
        )
      )
    ).toBe(false);
  });

  test("ignores auth and rate-limit failures", () => {
    expect(
      isOpenRouterToolSupportRejection(
        openRouterError(
          401,
          JSON.stringify({ error: { message: "No auth credentials found" } })
        )
      )
    ).toBe(false);
  });

  test("ignores errors that are not OpenRouter HTTP errors", () => {
    expect(
      isOpenRouterToolSupportRejection(
        new Error("No endpoints found that support tool use.")
      )
    ).toBe(false);
    expect(isOpenRouterToolSupportRejection(undefined)).toBe(false);
  });

  test("detects a vLLM endpoint that cannot serve tool choice", () => {
    expect(
      isOpenRouterToolSupportRejection(
        openRouterError(400, VLLM_TOOL_CHOICE_REJECTION_BODY)
      )
    ).toBe(true);
  });

  test("ignores an unrelated 400 from the same provider", () => {
    expect(
      isOpenRouterToolSupportRejection(
        openRouterError(
          400,
          JSON.stringify({
            error: {
              code: 400,
              message: "This endpoint's maximum context length is 8192 tokens.",
              metadata: { provider_name: "NextBit" },
            },
          })
        )
      )
    ).toBe(false);
  });

  test("ignores a rejection of the tool schema itself", () => {
    expect(
      isOpenRouterToolSupportRejection(
        openRouterError(
          400,
          JSON.stringify({
            error: {
              code: 400,
              message: "tools[0].function.parameters: invalid JSON schema.",
            },
          })
        )
      )
    ).toBe(false);
  });

  test("guidance forbids claiming tool use", () => {
    expect(OPENROUTER_TOOLS_UNAVAILABLE_GUIDANCE).toContain(
      "no tool-calling support"
    );
  });
});
