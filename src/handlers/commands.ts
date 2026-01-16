import { InteractionResponseType } from "discord-interactions";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { guildSettings, riotAccounts, schedules } from "../db/schema";
import { formatRankLabel } from "../features/riot";
import { fetchValorantRank } from "../features/riot";
import * as v from "../shared/validation";
import type { Env, InteractionBody } from "../lib/types";

export async function handleScheduleCommand(
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

export async function handleRiotCommand(
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
