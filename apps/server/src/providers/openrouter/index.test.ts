import { describe, expect, mock, test } from "bun:test";
import { createOpenRouterProvider } from "./index";

function chatCompletionResponse(
  content: string,
  options: { toolCalls?: unknown[]; reasoning?: string } = {}
) {
  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: {
          content,
          role: "assistant",
          ...(options.reasoning ? { reasoning: options.reasoning } : {}),
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
      },
    ],
    created: 1_700_000_000,
    id: "gen-test",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion",
    system_fingerprint: null,
  });
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

function streamChunk(delta: Record<string, unknown>): string {
  return `data:${JSON.stringify({
    choices: [{ delta, finish_reason: null, index: 0 }],
    created: 1_700_000_000,
    id: "chunk-1",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion.chunk",
  })}\r\n\r\n`;
}

function toolSupportRejectionBody(): string {
  return JSON.stringify({
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
}

function vllmToolChoiceRejectionBody(): string {
  return JSON.stringify({
    error: {
      code: 400,
      message: "Provider returned error",
      metadata: {
        provider_name: "NextBit",
        raw: JSON.stringify({
          error: {
            code: 400,
            message: JSON.stringify({
              error: {
                code: 400,
                message:
                  '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set',
                type: "BadRequestError",
              },
            }),
            type: "invalid_request_error",
          },
        }),
      },
    },
  });
}

describe("createOpenRouterProvider", () => {
  test("calls OpenRouter chat completions via SDK", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        expect(request.url).toContain("/chat/completions");
        const headers = request.headers;
        expect(headers.get("Authorization")).toBe("Bearer sk-or-v1-test");
        expect(headers.get("HTTP-Referer")).toBe(
          "https://github.com/ahmadrosid/nakama"
        );
        expect(headers.get("X-OpenRouter-Title")).toBe("Nakama");

        return new Response(chatCompletionResponse("Hello from OpenRouter"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "anthropic/claude-sonnet-4-6",
    });

    const result = await provider.generateText({
      format: "text",
      prompt: "Say hi",
      system: "You are helpful.",
    });

    expect(result.content).toBe("Hello from OpenRouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns tool calls from generateChat", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          chatCompletionResponse("", {
            toolCalls: [
              {
                function: { arguments: '{"path":"a.txt"}', name: "write_file" },
                id: "call_1",
                type: "function",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Create a file", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Write a file",
          name: "write_file",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      {
        arguments: { path: "a.txt" },
        id: "call_1",
        name: "write_file",
      },
    ]);
  });

  test("sends reasoning config when thinking is enabled", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          reasoning?: { effort?: string; summary?: string };
        };

        expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });

        return new Response(
          chatCompletionResponse("Answer", { reasoning: "Plan" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Think, then answer", role: "user" }],
      providerOptions: {
        thinking: { effort: "high", enabled: true },
      },
      system: "You are helpful.",
    });

    expect(result.content).toBe("Answer");
    expect(result.assistantMessage.thinking).toBe("Plan");
  });

  test("omits reasoning when custom model disables thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as { reasoning?: unknown };

        expect(body.reasoning).toBeUndefined();

        return new Response(chatCompletionResponse("Answer"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      customModels: [
        { id: "anthropic/claude-sonnet-4-6", supportsThinking: false },
      ],
      fetcher: fetchMock as typeof fetch,
      model: "anthropic/claude-sonnet-4-6",
    });

    await provider.generateChat({
      messages: [{ content: "Think, then answer", role: "user" }],
      providerOptions: {
        thinking: { effort: "high", enabled: true },
      },
      system: "You are helpful.",
    });
  });

  test("omits reasoning for models that do not support thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          reasoning?: unknown;
          model?: string;
        };

        expect(body.model).toBe("meta-llama/llama-4-maverick");
        expect(body.reasoning).toBeUndefined();

        return new Response(chatCompletionResponse("Answer"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "meta-llama/llama-4-maverick",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hello", role: "user" }],
      providerOptions: {
        thinking: { effort: "high", enabled: true },
      },
      system: "You are helpful.",
    });

    expect(result.content).toBe("Answer");
  });

  test("streams reasoning deltas when thinking is enabled", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          stream?: boolean;
          reasoning?: unknown;
        };

        expect(body.stream).toBe(true);
        expect(body.reasoning).toEqual({ effort: "medium", summary: "auto" });

        return new Response(
          streamFromChunks([
            streamChunk({ reasoning: "Plan" }),
            streamChunk({ content: "Hi" }),
            "data:[DONE]\r\n\r\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const chunks: string[] = [];
    const thinking: string[] = [];
    const result = await provider.streamChat(
      {
        messages: [{ content: "Think, then answer", role: "user" }],
        providerOptions: {
          thinking: { effort: "medium", enabled: true },
        },
        system: "You are helpful.",
      },
      {
        onChunk: (delta) => chunks.push(delta),
        onThinking: (delta) => thinking.push(delta),
      }
    );

    expect(result.content).toBe("Hi");
    expect(result.assistantMessage.thinking).toBe("Plan");
    expect(chunks).toEqual(["Hi"]);
    expect(thinking).toEqual(["Plan"]);
  });

  test("throws on empty generateText response", async () => {
    const fetchMock = mock(
      async () =>
        new Response(chatCompletionResponse("   "), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    await expect(
      provider.generateText({
        format: "text",
        prompt: "Say hi",
        system: "You are helpful.",
      })
    ).rejects.toThrow("OpenRouter returned an empty response.");
  });

  test("retries without tools when OpenRouter finds no tool-capable endpoint", async () => {
    const bodies: Array<{
      messages?: Array<{ role: string; content: string }>;
      tool_choice?: unknown;
      tools?: unknown[];
    }> = [];
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        bodies.push(await request.json());

        if (bodies.length === 1) {
          return new Response(toolSupportRejectionBody(), {
            headers: { "Content-Type": "application/json" },
            status: 404,
          });
        }

        return new Response(chatCompletionResponse("Answer without tools"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "thedrummer/cydonia-24b-v4.1",
    });

    const result = await provider.generateChat({
      messages: [{ content: "hi", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Run a shell command",
          name: "bash",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.content).toBe("Answer without tools");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.tools).toHaveLength(1);
    expect(bodies[0]?.tool_choice).toBe("auto");
    expect(bodies[1]?.tools).toBeUndefined();
    expect(bodies[1]?.tool_choice).toBeUndefined();
    expect(bodies[1]?.messages?.[0]?.content).toContain(
      "no tool-calling support"
    );
  });

  test("retries a stream without tools when tool use is unsupported", async () => {
    const bodies: Array<{ tools?: unknown[] }> = [];
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        bodies.push(await request.json());

        if (bodies.length === 1) {
          return new Response(toolSupportRejectionBody(), {
            headers: { "Content-Type": "application/json" },
            status: 404,
          });
        }

        return new Response(
          streamFromChunks([
            streamChunk({ content: "Hi" }),
            "data:[DONE]\r\n\r\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "thedrummer/cydonia-24b-v4.1",
    });

    const chunks: string[] = [];
    const result = await provider.streamChat(
      {
        messages: [{ content: "hi", role: "user" }],
        system: "You are helpful.",
        tools: [
          {
            description: "Run a shell command",
            name: "bash",
            parameters: { properties: {}, type: "object" },
          },
        ],
      },
      { onChunk: (delta) => chunks.push(delta) }
    );

    expect(result.content).toBe("Hi");
    expect(chunks).toEqual(["Hi"]);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.tools).toBeUndefined();
  });

  test("does not retry when the failure is unrelated to tool support", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 401, message: "No auth credentials found" },
          }),
          { headers: { "Content-Type": "application/json" }, status: 401 }
        )
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "thedrummer/cydonia-24b-v4.1",
    });

    await expect(
      provider.generateChat({
        messages: [{ content: "hi", role: "user" }],
        system: "You are helpful.",
        tools: [
          {
            description: "Run a shell command",
            name: "bash",
            parameters: { properties: {}, type: "object" },
          },
        ],
      })
    ).rejects.toThrow("OpenRouter request failed (401)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries without tools when the endpoint cannot serve tool choice", async () => {
    const bodies: Array<{
      messages?: Array<{ role: string; content: string }>;
      tool_choice?: unknown;
      tools?: unknown[];
    }> = [];
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        bodies.push(await request.json());

        if (bodies.length === 1) {
          return new Response(vllmToolChoiceRejectionBody(), {
            headers: { "Content-Type": "application/json" },
            status: 400,
          });
        }

        return new Response(chatCompletionResponse("Plain answer"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "thedrummer/unslopnemo-12b",
    });

    const result = await provider.generateChat({
      messages: [{ content: "hi", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Run a shell command",
          name: "bash",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.content).toBe("Plain answer");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.tools).toHaveLength(1);
    expect(bodies[1]?.tools).toBeUndefined();
    expect(bodies[1]?.tool_choice).toBeUndefined();
    expect(bodies[1]?.messages?.[0]?.content).toContain(
      "no tool-calling support"
    );
  });

  test("keeps image parts in the wire format OpenRouter expects", async () => {
    const bodies: Array<{ messages?: Array<{ content?: unknown }> }> = [];

    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        bodies.push((await request.json()) as (typeof bodies)[number]);

        return new Response(chatCompletionResponse("A cat."), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "google/gemini-2.5-flash",
    });

    const result = await provider.generateChat({
      messages: [
        {
          content: [
            { text: "What is this?", type: "text" },
            {
              data: "AAAA",
              mediaType: "image/png",
              type: "image",
            },
          ],
          role: "user",
        },
      ],
      system: "You are helpful.",
    });

    expect(result.content).toBe("A cat.");
    expect(bodies.at(-1)?.messages?.at(-1)?.content).toEqual([
      { text: "What is this?", type: "text" },
      {
        image_url: { url: "data:image/png;base64,AAAA" },
        type: "image_url",
      },
    ]);
  });
});
