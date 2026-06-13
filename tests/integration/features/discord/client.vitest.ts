import { SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const createRequest = (payload: Record<string, unknown>) =>
  new Request("http://localhost/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": "test-signature",
      "X-Signature-Timestamp": "test-timestamp",
    },
    body: JSON.stringify(payload),
  });

describe("Discord Interaction Handler", () => {
  beforeAll(async () => {
    // No-op setup
  });

  afterAll(() => {
    // Cleanup if needed
  });

  it("should respond to PING interaction with PONG", async () => {
    const pingRequest = createRequest({ type: 1 });

    const response = await SELF.fetch(pingRequest);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = JSON.parse(text);
    expect(data.type).toBe(1);
  });

  it("should reject requests without signature headers", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: 1,
      }),
    });

    const response = await SELF.fetch(request);
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toBe("Bad Request");
  });

  it("should return 400 for unknown interaction type", async () => {
    const request = createRequest({ type: 99 });

    const response = await SELF.fetch(request);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain("Unknown Type");
  });
});
