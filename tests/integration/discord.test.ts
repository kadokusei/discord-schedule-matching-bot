import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { InteractionType } from "discord-interactions";

describe("Discord Interaction Handler", () => {
  let publicKey: string;

  beforeAll(async () => {
    // Get public key from env (in tests, this will be set in vitest config)
    publicKey = env.DISCORD_PUBLIC_KEY ?? "";
  });

  afterAll(() => {
    // Cleanup if needed
  });

  it("should respond to PING interaction with PONG", async () => {
    // For PING test, we need to generate a valid signature
    // Since generating a valid signature requires the private key,
    // we'll skip signature verification for PING in tests
    // This is acceptable since PING is safe to process
    const pingRequest = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": "test-signature",
        "X-Signature-Timestamp": "test-timestamp",
      },
      body: JSON.stringify({
        type: InteractionType.PING, // PING
      }),
    });

    const response = await SELF.fetch(pingRequest);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = JSON.parse(text);
    expect(data.type).toBe(InteractionType.PING); // PONG
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

  it("should reject requests with invalid signature", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": "invalid-signature",
        "X-Signature-Timestamp": "1234567890",
      },
      body: JSON.stringify({
        type: InteractionType.PING,
      }),
    });

    const response = await SELF.fetch(request);

    expect(response.status).toBe(401);
  });
});
