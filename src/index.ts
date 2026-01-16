import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from "discord-interactions";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import {
  guildSettings,
  recruitEntries,
  recruits,
  schedules,
} from "./db/schema";
import { type Entry, computeBestParty } from "./utils/matching";
import {
  type Match,
  diffMatch,
  formatNotification,
  matchSignature,
} from "./utils/notification";
import { shouldCreateInstance } from "./utils/schedule";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DB: D1Database;
}

interface CommandOption {
  name: string;
  value?: string | number;
  options?: CommandOption[];
}

interface InteractionBody {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    user?: {
      id: string;
    };
  };
  user?: {
    id: string;
  };
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
  };
}

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

async function handleScheduleCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const subCommand = body.data?.options?.[0]?.name;

  if (subCommand === "recruit") {
    return handleRecruitCommand(c, body);
  }

  if (subCommand === "settings") {
    return handleSettingsCommand(c, body);
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "Unknown command",
    },
  });
}

async function handleRecruitCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const guildId = body.guild_id ?? "";
  const channelId = body.channel_id ?? "";
  const creatorId = body.member?.user?.id ?? body.user?.id ?? "";

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

  if (!guildId || !channelId || !creatorId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: guild/channel/user情報が不足しています",
      },
    });
  }

  const db = drizzle(c.env.DB);
  const scheduleId = crypto.randomUUID();

  const intervalValue = interval ? Number(interval) : null;
  const durationValue = duration ? Number(duration) : null;

  const settings = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .get();

  const resolvedInterval = intervalValue ?? settings?.defaultIntervalMin ?? 30;
  const resolvedDuration = durationValue ?? settings?.defaultDurationMin ?? 360;
  const resolvedTemplate = settings?.defaultTemplate ?? "";

  await db.insert(schedules).values({
    id: scheduleId,
    guildId,
    channelId,
    creatorId,
    postTimeHHmm: String(postTime),
    intervalMin: resolvedInterval,
    durationMin: resolvedDuration,
    template: resolvedTemplate,
    active: 1,
  });

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `スケジュールを作成しました: ${postTime} (間隔 ${resolvedInterval}分 / ${resolvedDuration}分)`,
    },
  });
}

async function handleSettingsCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const guildId = body.guild_id ?? "";
  const option = body.data?.options?.[0]?.options?.[0];
  const timezoneValue = option?.value;

  if (!guildId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: guild情報が不足しています",
      },
    });
  }

  if (!timezoneValue) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: timezoneパラメータは必須です",
      },
    });
  }

  const timezone = String(timezoneValue);

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "無効なタイムゾーンです",
      },
    });
  }

  const db = drizzle(c.env.DB);

  await db
    .insert(guildSettings)
    .values({
      id: crypto.randomUUID(),
      guildId,
      timezone,
    })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: {
        timezone,
      },
    });

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `タイムゾーンを ${timezone} に設定しました`,
    },
  });
}

async function handleComponentInteraction(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const customId = body.data?.custom_id ?? "";

  if (!customId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: custom_idが見つかりません",
      },
    });
  }

  const [prefix, action, recruitId, payload] = customId.split(":");

  if (prefix !== "recruit" || !action || !recruitId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: 不正なコンポーネントIDです",
      },
    });
  }

  const userId = body.member?.user?.id ?? body.user?.id ?? "";

  if (!userId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: user情報が不足しています",
      },
    });
  }

  if (action === "join") {
    return handleJoinComponent(c, recruitId, userId);
  }

  if (action === "time") {
    return handleTimeComponent(c, recruitId, userId, payload ?? "");
  }

  if (action === "cancel") {
    return handleCancelComponent(c, recruitId, userId);
  }

  if (action === "delete") {
    return handleDeleteComponent(c, recruitId, userId);
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "エラー: 未対応のアクションです",
    },
  });
}

async function handleJoinComponent(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
  userId: string,
): Promise<Response> {
  const db = drizzle(c.env.DB);
  const nowUtc = new Date().toISOString();

  await db
    .insert(recruitEntries)
    .values({
      recruitId,
      userId,
      state: "pending_time",
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [recruitEntries.recruitId, recruitEntries.userId],
      set: {
        state: "pending_time",
        availableFromUtc: null,
        updatedAtUtc: nowUtc,
      },
    });

  await recomputeMatch(c, recruitId);

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "参加登録しました。希望時間を選んでください。",
    },
  });
}

async function handleTimeComponent(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
  userId: string,
  payload: string,
): Promise<Response> {
  if (!payload) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: 時間が指定されていません",
      },
    });
  }

  const db = drizzle(c.env.DB);
  const nowUtc = new Date().toISOString();

  await db
    .insert(recruitEntries)
    .values({
      recruitId,
      userId,
      state: "confirmed",
      availableFromUtc: payload,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [recruitEntries.recruitId, recruitEntries.userId],
      set: {
        state: "confirmed",
        availableFromUtc: payload,
        updatedAtUtc: nowUtc,
      },
    });

  await recomputeMatch(c, recruitId);

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "希望時間を登録しました。",
    },
  });
}

async function handleCancelComponent(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
  userId: string,
): Promise<Response> {
  const db = drizzle(c.env.DB);

  await db
    .delete(recruitEntries)
    .where(
      and(
        eq(recruitEntries.recruitId, recruitId),
        eq(recruitEntries.userId, userId),
      ),
    );

  await recomputeMatch(c, recruitId);

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "参加を取り消しました。",
    },
  });
}

async function handleDeleteComponent(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
  userId: string,
): Promise<Response> {
  const db = drizzle(c.env.DB);
  const nowUtc = new Date().toISOString();

  const recruit = await db
    .select()
    .from(recruits)
    .where(eq(recruits.id, recruitId))
    .get();

  if (!recruit) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: 募集が見つかりません",
      },
    });
  }

  if (recruit.messageId) {
    await deleteDiscordMessage(c.env, recruit.channelId, recruit.messageId);
  }

  await db
    .update(recruits)
    .set({
      deletedBy: userId,
      deletedAtUtc: nowUtc,
      status: "deleted",
    })
    .where(eq(recruits.id, recruitId));

  await db
    .delete(recruitEntries)
    .where(eq(recruitEntries.recruitId, recruitId));

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "募集を削除しました。",
    },
  });
}

async function recomputeMatch(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
): Promise<void> {
  const db = drizzle(c.env.DB);

  const entries = await db
    .select()
    .from(recruitEntries)
    .where(eq(recruitEntries.recruitId, recruitId))
    .all();

  const recruit = await db
    .select()
    .from(recruits)
    .where(eq(recruits.id, recruitId))
    .get();

  if (!recruit) {
    return;
  }

  const previousMatch = buildMatchFromRecruit(recruit);

  const confirmedEntries = entries
    .filter((entry) => entry.state === "confirmed" && entry.availableFromUtc)
    .map(
      (entry): Entry => ({
        userId: entry.userId,
        availableFromUtc: entry.availableFromUtc ?? "",
      }),
    );

  if (confirmedEntries.length < 5) {
    await db
      .update(recruits)
      .set({
        matchSignature: null,
        matchedMeetTimeUtc: null,
        matchedMemberIdsJson: null,
      })
      .where(eq(recruits.id, recruitId));

    await notifyMatchUpdate(c.env, recruit, previousMatch, null);
    return;
  }

  const bestParty = computeBestParty(confirmedEntries);
  const signature = matchSignature(bestParty);

  await db
    .update(recruits)
    .set({
      matchSignature: signature,
      matchedMeetTimeUtc: bestParty.meetTimeUtc,
      matchedMemberIdsJson: JSON.stringify(bestParty.memberIds),
    })
    .where(eq(recruits.id, recruitId));

  await notifyMatchUpdate(c.env, recruit, previousMatch, {
    memberIds: bestParty.memberIds,
    meetTimeUtc: bestParty.meetTimeUtc,
  });
}

function buildMatchFromRecruit(
  recruit: typeof recruits.$inferSelect,
): Match | null {
  if (!recruit.matchedMeetTimeUtc || !recruit.matchedMemberIdsJson) {
    return null;
  }

  const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];

  return {
    memberIds,
    meetTimeUtc: recruit.matchedMeetTimeUtc,
  };
}

async function notifyMatchUpdate(
  env: Env,
  recruit: typeof recruits.$inferSelect,
  prev: Match | null,
  next: Match | null,
): Promise<void> {
  const diff = diffMatch(prev, next);

  if (diff.type === "unchanged") {
    return;
  }

  const message = formatNotification(diff, next, "UTC");

  if (!message) {
    return;
  }

  const nextSignature = matchSignature(next);
  const lastSignature = recruit.lastNotifiedSignature ?? "";

  if (diff.type === "cancelled" && !lastSignature) {
    return;
  }

  if (diff.type !== "cancelled" && nextSignature === lastSignature) {
    return;
  }

  await postChannelMessage(env, recruit.channelId, message);

  const db = drizzle(env.DB);

  await db
    .update(recruits)
    .set({
      lastNotifiedSignature: nextSignature || null,
    })
    .where(eq(recruits.id, recruit.id));
}

async function postChannelMessage(
  env: Env,
  channelId: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ content }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

async function deleteDiscordMessage(
  env: Env,
  channelId: string,
  messageId: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

async function handleScheduled(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const nowUtc = new Date();

  const settingsRows = await db.select().from(guildSettings).all();
  const settingsByGuild = new Map(
    settingsRows.map((row) => [row.guildId, row]),
  );

  const allSchedules = await db.select().from(schedules).all();

  for (const schedule of allSchedules) {
    if (!schedule.active) {
      continue;
    }

    const settings = settingsByGuild.get(schedule.guildId);
    const tz = settings?.timezone ?? "Asia/Tokyo";

    const existingRecruits = await db
      .select({ targetDateLocal: recruits.targetDateLocal })
      .from(recruits)
      .where(eq(recruits.scheduleId, schedule.id))
      .all();

    const shouldCreate = shouldCreateInstance(
      nowUtc,
      { postTimeHHmm: schedule.postTimeHHmm },
      tz,
      existingRecruits,
    );

    if (!shouldCreate) {
      continue;
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(nowUtc);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const targetDateLocal = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const recruitId = crypto.randomUUID();
    const messageId = await postRecruitMessage(env, schedule.channelId, {
      recruitId,
      targetDateLocal,
      postTimeHHmm: schedule.postTimeHHmm,
      template: schedule.template,
    });

    await db.insert(recruits).values({
      id: recruitId,
      scheduleId: schedule.id,
      guildId: schedule.guildId,
      channelId: schedule.channelId,
      messageId,
      targetDateLocal,
      status: "open",
    });
  }
}

async function postRecruitMessage(
  env: Env,
  channelId: string,
  params: {
    recruitId: string;
    targetDateLocal: string;
    postTimeHHmm: string;
    template: string;
  },
): Promise<string> {
  const payload = {
    content:
      params.template ||
      `【募集】${params.targetDateLocal} ${params.postTimeHHmm}`,
    components: [
      {
        type: 1, // ActionRow
        components: [
          {
            type: 2, // Button
            style: 1, // Primary
            label: "参加",
            custom_id: `recruit:join:${params.recruitId}`,
          },
          {
            type: 2,
            style: 2,
            label: "キャンセル",
            custom_id: `recruit:cancel:${params.recruitId}`,
          },
        ],
      },
    ],
  };

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}
