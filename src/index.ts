import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from "discord-interactions";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import {
  guildSettings,
  recruitEntries,
  recruits,
  riotAccounts,
  schedules,
} from "./db/schema";
import { buildRecruitEmbed } from "./utils/embed";
import {
  type Entry,
  computeBestParty,
  formatRankEvaluation,
} from "./utils/matching";
import {
  type Match,
  diffMatch,
  formatNotification,
  matchSignature,
} from "./utils/notification";
import { formatRankLabel, fetchValorantRank } from "./utils/riot";
import { buildTimeOptions } from "./utils/time";
import { shouldCreateInstance } from "./utils/schedule";
import { buildReminderMessage, filterPendingReminders } from "./utils/reminder";
import * as v from "./utils/validation";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  HENRIKDEV_API_KEY: string;
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
    values?: string[];
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

  const optionsObj = Object.fromEntries(
    (body.data?.options?.[0]?.options ?? []).map((opt) => [
      opt.name,
      opt.value,
    ]),
  );

  const parsed = v.recruitOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: parsed.error.issues[0].message,
      },
    });
  }

  const { post_time, interval, duration } = parsed.data;

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

  const intervalValue = interval ?? null;
  const durationValue = duration ?? null;

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
    postTimeHHmm: post_time,
    intervalMin: resolvedInterval,
    durationMin: resolvedDuration,
    template: resolvedTemplate,
    active: 1,
  });

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `スケジュールを作成しました: ${post_time} (間隔 ${resolvedInterval}分 / ${resolvedDuration}分)`,
    },
  });
}

async function handleSettingsCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const guildId = body.guild_id ?? "";

  if (!guildId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: guild情報が不足しています",
      },
    });
  }

  const optionsObj = Object.fromEntries(
    (body.data?.options?.[0]?.options ?? []).map((opt) => [
      opt.name,
      opt.value,
    ]),
  );

  const parsed = v.settingsOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: parsed.error.issues[0].message,
      },
    });
  }

  const { timezone } = parsed.data;

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

async function handleRiotCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const subCommand = body.data?.options?.[0]?.name;

  if (subCommand === "account") {
    return handleRiotAccountCommand(c, body);
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "Unknown command",
    },
  });
}

async function handleRiotAccountCommand(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const action = body.data?.options?.[0]?.options?.[0]?.name;

  if (action === "add") {
    return handleRiotAccountAdd(c, body);
  }

  if (action === "remove") {
    return handleRiotAccountRemove(c, body);
  }

  if (action === "list") {
    return handleRiotAccountList(c, body);
  }

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "Unknown action",
    },
  });
}

async function handleRiotAccountAdd(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const userId = body.member?.user?.id ?? body.user?.id ?? "";
  const options = body.data?.options?.[0]?.options?.[0]?.options ?? [];

  if (!userId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: user情報が不足しています",
      },
    });
  }

  const optionsObj = Object.fromEntries(
    options.map((opt) => [opt.name, opt.value]),
  );

  const parsed = v.riotAccountAddOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: firstError.message,
      },
    });
  }

  const { game_name, tag_line, region } = parsed.data;

  // Riot ID のバリデーション（#を含む場合は分割）
  let finalGameName = game_name;
  let finalTagLine = tag_line;

  if (finalGameName.includes("#")) {
    const [name, tag] = finalGameName.split("#");
    finalGameName = name;
    finalTagLine = tag || finalTagLine;
  }

  // HenrikDev API でランクを取得
  const rankResult = await fetchValorantRank(
    finalGameName,
    finalTagLine,
    c.env.HENRIKDEV_API_KEY,
    region,
  );

  if (!rankResult.success || !rankResult.account) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `エラー: ${rankResult.error ?? "アカウントが見つかりません"}`,
      },
    });
  }

  const db = drizzle(c.env.DB);
  const nowUtc = new Date().toISOString();

  // アカウントを登録
  await db.insert(riotAccounts).values({
    id: crypto.randomUUID(),
    userId,
    gameName: finalGameName,
    tagLine: finalTagLine,
    region,
    rank: rankResult.account.rank?.rank ?? "Unrated",
    createdAtUtc: nowUtc,
  });

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `アカウントを登録しました: ${formatRankLabel(rankResult.account)}`,
    },
  });
}

async function handleRiotAccountRemove(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const userId = body.member?.user?.id ?? body.user?.id ?? "";
  const options = body.data?.options?.[0]?.options?.[0]?.options ?? [];

  if (!userId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: user情報が不足しています",
      },
    });
  }

  const optionsObj = Object.fromEntries(
    options.map((opt) => [opt.name, opt.value]),
  );

  const parsed = v.riotAccountRemoveOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: parsed.error.issues[0].message,
      },
    });
  }

  const { game_name, tag_line } = parsed.data;

  const db = drizzle(c.env.DB);

  if (game_name && tag_line) {
    // 特定のアカウントを削除
    await db
      .delete(riotAccounts)
      .where(
        and(
          eq(riotAccounts.userId, userId),
          eq(riotAccounts.gameName, game_name),
          eq(riotAccounts.tagLine, tag_line),
        ),
      );

    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `アカウントを削除しました: ${game_name}#${tag_line}`,
      },
    });
  }
  // 全てのアカウントを削除
  await db.delete(riotAccounts).where(eq(riotAccounts.userId, userId));

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "全てのアカウントを削除しました",
    },
  });
}

async function handleRiotAccountList(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const userId = body.member?.user?.id ?? body.user?.id ?? "";

  if (!userId) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: user情報が不足しています",
      },
    });
  }

  const db = drizzle(c.env.DB);

  const accounts = await db
    .select()
    .from(riotAccounts)
    .where(eq(riotAccounts.userId, userId))
    .all();

  if (accounts.length === 0) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "登録されているアカウントはありません",
      },
    });
  }

  const accountList = accounts
    .map((acc) => `- ${acc.gameName}#${acc.tagLine} (${acc.rank})`)
    .join("\n");

  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `登録されているアカウント:\n${accountList}`,
    },
  });
}

async function handleComponentInteraction(
  c: Context<{ Bindings: Env }>,
  body: InteractionBody,
): Promise<Response> {
  const customId = body.data?.custom_id ?? "";
  const values = body.data?.values;

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

  if (action === "time" && values && values.length > 0) {
    return handleTimeSelect(c, recruitId, userId, values[0]);
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

  // recruit を取得して scheduleId を取得
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

  // schedule を取得
  const schedule = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, recruit.scheduleId))
    .get();

  // guildSettings を取得
  const settings = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, recruit.guildId))
    .get();

  const intervalMin =
    schedule?.intervalMin ?? settings?.defaultIntervalMin ?? 30;
  const durationMin =
    schedule?.durationMin ?? settings?.defaultDurationMin ?? 360;
  const timezone = settings?.timezone ?? "Asia/Tokyo";

  // 時間オプションを生成
  const timeOptions = buildTimeOptions(
    recruit.targetDateLocal,
    schedule?.postTimeHHmm ?? "20:00",
    intervalMin,
    durationMin,
    timezone,
  );

  // pending_time 状態で登録
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

  // StringSelect メニューを含む UPDATE_MESSAGE レスポンスを返す
  return c.json({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: "参加登録しました。希望時間を選んでください。",
      components: [
        {
          type: 1, // ActionRow
          components: [
            {
              type: 3, // StringSelect
              custom_id: `recruit:time:${recruitId}`,
              placeholder: "希望時間を選択",
              options: timeOptions.map((opt) => ({
                label: opt.label,
                value: opt.value,
              })),
              min_values: 1,
              max_values: 1,
            },
          ],
        },
      ],
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

async function handleTimeSelect(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
  userId: string,
  selectedTime: string,
): Promise<Response> {
  if (!selectedTime) {
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "エラー: 時間が指定されていません",
      },
    });
  }

  const db = drizzle(c.env.DB);
  const nowUtc = new Date().toISOString();

  // recruit を取得して guildId を取得
  const recruit = await db
    .select()
    .from(recruits)
    .where(eq(recruits.id, recruitId))
    .get();

  // guildSettings を取得
  const settings = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, recruit?.guildId ?? ""))
    .get();

  const timezone = settings?.timezone ?? "Asia/Tokyo";

  await db
    .insert(recruitEntries)
    .values({
      recruitId,
      userId,
      state: "confirmed",
      availableFromUtc: selectedTime,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [recruitEntries.recruitId, recruitEntries.userId],
      set: {
        state: "confirmed",
        availableFromUtc: selectedTime,
        updatedAtUtc: nowUtc,
      },
    });

  await recomputeMatch(c, recruitId);

  return c.json({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: `希望時間を登録しました: ${new Date(selectedTime).toLocaleString("ja-JP", { timeZone: timezone })}`,
      components: [],
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

  // schedule を取得して postTimeHHmm を取得
  const schedule = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, recruit.scheduleId))
    .get();

  const postTimeHHmm = schedule?.postTimeHHmm ?? "20:00";

  // guildSettings を取得してタイムゾーンを取得
  const settings = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, recruit.guildId))
    .get();

  const timezone = settings?.timezone ?? "Asia/Tokyo";

  // 参加状況を計算
  const confirmedCount = entries.filter(
    (entry) => entry.state === "confirmed",
  ).length;
  const pendingCount = entries.filter(
    (entry) => entry.state === "pending_time",
  ).length;

  const previousMatch = buildMatchFromRecruit(recruit);

  // 各ユーザーのランク情報を取得
  const userIds = entries.map((e) => e.userId);
  const riotAccountList = await db
    .select()
    .from(riotAccounts)
    .where(inArray(riotAccounts.userId, userIds))
    .all();

  const userRanks = new Map<string, string>();
  for (const account of riotAccountList) {
    userRanks.set(account.userId, account.rank);
  }

  const confirmedEntries = entries
    .filter((entry) => entry.state === "confirmed" && entry.availableFromUtc)
    .map(
      (entry): Entry => ({
        userId: entry.userId,
        availableFromUtc: entry.availableFromUtc ?? "",
        rank: userRanks.get(entry.userId),
      }),
    );

  if (confirmedEntries.length < 5) {
    await db
      .update(recruits)
      .set({
        status: "open",
        matchSignature: null,
        matchedMeetTimeUtc: null,
        matchedMemberIdsJson: null,
      })
      .where(eq(recruits.id, recruitId));

    // Embed を更新
    try {
      await updateDiscordMessage(c.env, recruit.channelId, recruit.messageId, {
        targetDateLocal: recruit.targetDateLocal,
        postTimeHHmm,
        status: "open",
        confirmedCount,
        pendingCount,
      });
    } catch (error) {
      console.error(
        `Failed to update Discord message for recruit ${recruitId}:`,
        error,
      );
    }

    // ランク評価メッセージをチャンネルに送信
    if (confirmedEntries.length > 0) {
      try {
        const rankEvaluation = formatRankEvaluation(confirmedEntries);
        await postChannelMessage(
          c.env,
          recruit.channelId,
          `【現在の参加状況】\n${rankEvaluation}`,
        );
      } catch (error) {
        console.error(
          `Failed to send rank evaluation message for recruit ${recruitId}:`,
          error,
        );
      }
    }

    await notifyMatchUpdate(c.env, recruit, previousMatch, null);
    return;
  }

  const bestParty = computeBestParty(confirmedEntries);
  const signature = matchSignature(bestParty);

  await db
    .update(recruits)
    .set({
      status: "matched",
      matchSignature: signature,
      matchedMeetTimeUtc: bestParty.meetTimeUtc,
      matchedMemberIdsJson: JSON.stringify(bestParty.memberIds),
    })
    .where(eq(recruits.id, recruitId));

  // Embed を更新
  try {
    await updateDiscordMessage(c.env, recruit.channelId, recruit.messageId, {
      targetDateLocal: recruit.targetDateLocal,
      postTimeHHmm,
      status: "matched",
      confirmedCount,
      pendingCount,
      matchedMembers: bestParty.memberIds,
      matchedTime: new Date(bestParty.meetTimeUtc).toLocaleTimeString("ja-JP", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  } catch (error) {
    console.error(
      `Failed to update Discord message for recruit ${recruitId}:`,
      error,
    );
  }

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

  try {
    const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
    if (!Array.isArray(memberIds)) {
      return null;
    }
    return {
      memberIds,
      meetTimeUtc: recruit.matchedMeetTimeUtc,
    };
  } catch {
    return null;
  }
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

  // リマインド処理
  const pendingEntries = await db
    .select()
    .from(recruitEntries)
    .where(eq(recruitEntries.state, "pending_time"))
    .all();

  if (pendingEntries.length > 0) {
    // recruit 情報を取得
    const recruitIds = pendingEntries.map((e) => e.recruitId);
    const recruitsData = await db
      .select()
      .from(recruits)
      .where(inArray(recruits.id, recruitIds))
      .all();

    const recruitsByRecruitId = new Map(recruitsData.map((r) => [r.id, r]));

    // 各ギルドの設定を取得
    const guildIds = recruitsData.map((r) => r.guildId);
    const guildSettingsData = await db
      .select()
      .from(guildSettings)
      .where(inArray(guildSettings.guildId, guildIds))
      .all();

    const settingsByGuildId = new Map(
      guildSettingsData.map((s) => [s.guildId, s]),
    );

    // リマインド対象をフィルタリング
    const reminderTargets = filterPendingReminders(
      pendingEntries.map((entry) => ({
        userId: entry.userId,
        recruitId: entry.recruitId,
        channelId: recruitsByRecruitId.get(entry.recruitId)?.channelId ?? "",
        lastRemindedAtUtc: entry.lastRemindedAtUtc,
      })),
      settingsByGuildId.get(recruitsData[0]?.guildId ?? "")
        ?.reminderIntervalMin,
      nowUtc,
    );

    // リマインドを送信
    for (const target of reminderTargets) {
      const recruit = recruitsByRecruitId.get(target.recruitId);
      if (!recruit) continue;

      const reminderMessage = buildReminderMessage(target.recruitId);

      try {
        // チャンネルメンションで通知
        await postChannelMessage(
          env,
          target.channelId,
          `<@${target.userId}> ${reminderMessage}`,
        );

        // メッセージ送信成功後のみリマインド時刻を更新
        await db
          .update(recruitEntries)
          .set({
            lastRemindedAtUtc: nowUtc.toISOString(),
          })
          .where(
            and(
              eq(recruitEntries.recruitId, target.recruitId),
              eq(recruitEntries.userId, target.userId),
            ),
          );
      } catch (error) {
        // リマインド送信失敗時はログに出力して、次のターゲットに進む
        console.error(
          `Failed to send reminder to user ${target.userId} in recruit ${target.recruitId}:`,
          error,
        );
      }
    }
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
  const embedData = buildRecruitEmbed({
    targetDateLocal: params.targetDateLocal,
    postTimeHHmm: params.postTimeHHmm,
    status: "open",
    confirmedCount: 0,
    pendingCount: 0,
  });

  const payload = {
    content:
      params.template ||
      `【募集】${params.targetDateLocal} ${params.postTimeHHmm}`,
    embeds: embedData.embeds,
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

async function updateDiscordMessage(
  env: Env,
  channelId: string,
  messageId: string,
  params: {
    targetDateLocal: string;
    postTimeHHmm: string;
    status: "open" | "matched" | "cancelled" | "deleted";
    confirmedCount: number;
    pendingCount: number;
    matchedMembers?: string[];
    matchedTime?: string;
  },
): Promise<void> {
  const embedData = buildRecruitEmbed(params);

  const payload = {
    embeds: embedData.embeds,
  };

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
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
}
