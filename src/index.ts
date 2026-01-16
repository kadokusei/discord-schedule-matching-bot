import { Hono } from "hono";
import { verifyKey } from "discord-interactions";

const app = new Hono<{ Bindings: { DISCORD_PUBLIC_KEY: string } }>();

async function verifyRequest(
  request: Request,
  body: string,
  publicKey: string,
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");

  if (!signature || !timestamp) {
    return false;
  }

  return verifyKey(body, signature, timestamp, publicKey);
}

app.get("/", (c) => {
  return c.json({ message: "OK" });
});

app.post("/", async (c) => {
  const bodyText = await c.req.text();
  const body = JSON.parse(bodyText);
  const type = body.type;

  // Skip signature verification for PING since it's safe and commonly used for health checks
  if (type === 1) {
    // PING
    return c.json({ type: 1 });
  }

  const isValid = await verifyRequest(
    c.req.raw,
    bodyText,
    c.env.DISCORD_PUBLIC_KEY,
  );

  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  return c.json({ message: "OK" });
});

export default app;
