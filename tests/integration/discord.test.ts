import { SELF, env } from "cloudflare:test";
import { InteractionType } from "discord-interactions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Discord Interaction Handler", () => {
  let publicKey: string;

  beforeAll(async () => {
    publicKey = env.DISCORD_PUBLIC_KEY ?? "";
  });

  afterAll(() => {
    // Cleanup if needed
  });

  it("should respond to PING interaction with PONG", async () => {
    const pingRequest = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": "test-signature",
        "X-Signature-Timestamp": "test-timestamp",
      },
      body: JSON.stringify({
        type: InteractionType.PING,
      }),
    });

    const response = await SELF.fetch(pingRequest);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = JSON.parse(text);
    expect(data.type).toBe(InteractionType.PING);
  });

  it("should reject requests without signature headers", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: InteractionType.PING,
      }),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(401);
  });

  it("should return 400 for unknown interaction types", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: 99,
      }),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(data.type).toBe(99);
  });
});
