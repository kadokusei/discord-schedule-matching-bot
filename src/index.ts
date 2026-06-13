import type {
  APIApplicationCommandInteraction,
  APIInteraction,
  APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { InteractionResponseType, InteractionType } from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { Hono } from "hono";
import { handleCommandInteraction, handleComponentInteraction, handleScheduled } from "./handlers";
import type { Env } from "./lib/types";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("Discord VALORANT Schedule Matching Bot"));

// Discord Interaction エンドポイント（Developer Portal の Interactions Endpoint URL）
app.post("/", async (c) => {
  const env = c.env;
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  const rawBody = await c.req.text();

  // 署名ヘッダの存在は常に必須。暗号検証のみ DISABLE_SIGNATURE_VERIFICATION で無効化可能。
  if (!signature || !timestamp) {
    return c.text("Bad Request", 401);
  }

  if (env.DISABLE_SIGNATURE_VERIFICATION !== "true") {
    const isValid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!isValid) {
      return c.text("Bad Request", 401);
    }
  }

  const interaction = JSON.parse(rawBody) as APIInteraction;

  switch (interaction.type) {
    case InteractionType.Ping:
      return c.json({ type: InteractionResponseType.Pong });

    case InteractionType.ApplicationCommand: {
      const response = await handleCommandInteraction(
        interaction as APIApplicationCommandInteraction,
        env,
        c.executionCtx,
      );
      return c.json(response);
    }

    case InteractionType.MessageComponent: {
      const response = handleComponentInteraction(
        interaction as APIMessageComponentInteraction,
        env,
        c.executionCtx,
      );
      return c.json(response);
    }

    default:
      return c.text("Unknown Type", 400);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};
