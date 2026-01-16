import { InteractionResponseType, verifyKey } from "discord-interactions";
import { InteractionType } from "discord-interactions";
import { type Context, Hono } from "hono";

interface Env {
  DISCORD_PUBLIC_KEY: string;
}

interface CommandData {
  name: string;
  options?: Array<{
    name: string;
    value?: string;
    options?: Array<{
      name: string;
      value?: string;
    }>;
  }>;
}

interface InteractionBody {
  type: number;
  data?: CommandData;
}

const app = new Hono<{ Bindings: Env }>();

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
  } catch (error) {
    return false;
  }
}

  try {
    const isValid = await verifyKey(body, signature, timestamp, publicKey);
    console.log(`[verifyRequest] verifyKey result: ${isValid}`);
    return isValid;
  } catch (error) {
    console.log(`[verifyRequest] verifyKey error: ${error}`);
    return false;
  }
}

  try {
    const isValid = await verifyKey(body, signature, timestamp, publicKey);
    console.log(`[verifyRequest] verifyKey result: ${isValid}`);
    return isValid;
  } catch (error) {
    console.log(`[verifyRequest] verifyKey error: ${error}`);
    return false;
  }

  return true;
}

  const isValid = await verifyRequest(
    request,
    body,
    publicKey,
  );

  try {
    const isValid = await verifyKey(body, signature, timestamp, publicKey);
    console.log(`[verifyRequest] verifyKey result: ${isValid}`);
    return isValid;
  } catch (error) {
    console.log(`[verifyRequest] verifyKey error: ${error}`);
    return false;
  }
}

app.get("/", (c) => {
  return c.json({ message: "OK" });
});

app.post("/", async (c) => {
  const bodyText = await c.req.text();
  const body = JSON.parse(bodyText);
  const type = body.type;

  console.log(`[POST] body: ${JSON.stringify(body)}`);

  // Skip signature verification for PING since it's safe and commonly used for health checks
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

  // Application commands only
  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = body.data?.name;

    if (commandName === "schedule") {
      return handleScheduleCommand(c, body);
    }
  }

  return c.json({ message: "OK" });
});
  }
});
} else if (type === InteractionType.PING) {
  // PING
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
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "Unknown command",
    },
  });
}

  return new Response("Unknown interaction type", { status: 400 });
  }
  }

  return new Response("Unknown interaction type", { status: 400 });
});

function handleScheduleCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Response {
  const subCommand = body.data?.options?.[0]?.name;

  if (subCommand === "recruit") {
    return handleRecruitCommand(c, body);
  }

  if (subCommand === "settings") {
    return handleSettingsCommand(c);
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "Unknown command",
    },
  });
}

function handleRecruitCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Response {
  const postTime = body.data?.options?.[0]?.value;
  const interval = body.data?.options?.[1]?.value;
  const duration = body.data?.options?.[2]?.value;

  if (!postTime) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: post_timeパラメータは必須です",
      },
    });
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `スケジュール作成コマンドが実行されました (post_time: ${postTime}, interval: ${interval}, duration: ${duration})`,
    },
  });
}

function handleSettingsCommand(c: Context<{ Bindings: Env }>): Response {
  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "タイムゾーン設定コマンドが実行されました",
    },
  });
}

export default app;
