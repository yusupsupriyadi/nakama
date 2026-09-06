import { describe, expect, test } from "bun:test";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

describe("session turn release on a refused origin", () => {
  test("a refused client origin does not leave the turn active", async () => {
    const sessionId = "session_origin_reject";
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        // Mirrors AgentService.beginSessionTurn so the real registry decides.
        beginSessionTurn: async (id: string) =>
          sessionTurnRegistry.beginTurn(id).started,
        resolveSession: async () => ({
          send: async () => ({ reply: "ok" }),
        }),
      },
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${sessionId}/messages`, {
        body: JSON.stringify({ message: "hi" }),
        headers: session.headers({
          "Content-Type": "application/json",
          Origin: "https://evil.example.com",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(sessionTurnRegistry.isActive(sessionId)).toBe(false);
  });
});
