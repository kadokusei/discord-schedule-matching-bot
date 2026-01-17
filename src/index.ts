import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from "discord-interactions";
import { Hono } from "hono";
import { handleScheduleCommand, handleRiotCommand } from "./handlers/commands";
import { handleComponentInteraction } from "./handlers/components";
import { handleScheduled } from "./handlers/scheduled";
import type { Env, InteractionBody } from "./lib/types";

const app = new Hono<{ Bindings: Env }>();

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};

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

  try {
    return await verifyKey(body, signature, timestamp, publicKey);
  } catch {
    return false;
  }
}

app.get("/", (c) => {
  return c.json({ message: "OK" });
});

app.post("/", async (c) => {
  const bodyText = await c.req.text();
  const body: InteractionBody = JSON.parse(bodyText);
  const type = body.type;

  if (type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  const isValid = await verifyRequest(
    c.req.raw,
    bodyText,
    c.env.DISCORD_PUBLIC_KEY,
  );

  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = body.data?.name;

    if (commandName === "schedule") {
      return handleScheduleCommand(c, body);
    }

    if (commandName === "riot") {
      return handleRiotCommand(c, body);
    }

    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Unknown command",
      },
    });
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    return handleComponentInteraction(c, body);
  }

  return new Response("Unknown interaction type", { status: 400 });
});
