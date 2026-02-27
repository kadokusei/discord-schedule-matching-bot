import type { CommandContext } from "discord-hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { fetchValorantRankWithCache, formatRankLabel } from "../features/riot";
import type { Env } from "../lib/types";
import * as v from "../shared/validation";

const isChatInputData = (
  data: unknown,
): data is {
  options: Array<{
    name: string;
    value: string | number;
    options?: { name: string; value: string | number }[];
  }>;
} => {
  return (
    typeof data === "object" &&
    data !== null &&
    "options" in data &&
    Array.isArray((data as { options: unknown }).options)
  );
};

export const handlerScheduleRecruit = async (
  c: CommandContext<{ Bindings: Env }>,
) => {
  const guildId = c.interaction.guild_id;
  const channelId = c.interaction.channel_id;
  const creatorId =
    c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";

  const optionsObj = Object.fromEntries(
    isChatInputData(c.interaction.data)
      ? c.interaction.data.options.map((opt) => [opt.name, opt.value])
      : [],
  );

  const parsed = v.recruitOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.res(parsed.error.issues[0].message);
  }

  const { post_time, interval, duration } = parsed.data;

  if (!guildId || !channelId || !creatorId) {
    return c.res("エラー: guild/channel/user情報が不足しています");
  }

  const db = drizzle(c.env.DB, { schema });
  const scheduleId = crypto.randomUUID();

  const settings = await db
    .select()
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, guildId))
    .get();

  const resolvedInterval = interval ?? settings?.defaultIntervalMin ?? 30;
  const resolvedDuration = duration ?? settings?.defaultDurationMin ?? 360;
  const resolvedTemplate = settings?.defaultTemplate ?? "";

  await db.insert(schema.schedules).values({
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

  return c.res(
    `スケジュールを作成しました: ${post_time} (間隔 ${resolvedInterval}分 / ${resolvedDuration}分)`,
  );
};

export const handlerScheduleSettings = async (
  c: CommandContext<{ Bindings: Env }>,
) => {
  const guildId = c.interaction.guild_id;

  if (!guildId) {
    return c.res("エラー: guild情報が不足しています");
  }

  const optionsObj = Object.fromEntries(
    isChatInputData(c.interaction.data)
      ? c.interaction.data.options.map((opt) => [opt.name, opt.value])
      : [],
  );

  const parsed = v.settingsOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.res(parsed.error.issues[0].message);
  }

  const { timezone } = parsed.data;

  const db = drizzle(c.env.DB, { schema });

  await db
    .insert(schema.guildSettings)
    .values({
      id: crypto.randomUUID(),
      guildId,
      timezone,
    })
    .onConflictDoUpdate({
      target: schema.guildSettings.guildId,
      set: {
        timezone,
      },
    });

  return c.res(`タイムゾーンを ${timezone} に設定しました`);
};

export const handlerRiotAccountAdd = async (
  c: CommandContext<{ Bindings: Env }>,
) => {
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";
  const options =
    isChatInputData(c.interaction.data) &&
    c.interaction.data.options[0]?.options
      ? c.interaction.data.options[0].options
      : [];

  if (!userId) {
    return c.res("エラー: user情報が不足しています");
  }

  const optionsObj = Object.fromEntries(
    options.map((opt: { name: string; value: string | number }) => [
      opt.name,
      opt.value,
    ]),
  );

  const parsed = v.riotAccountAddOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.res(parsed.error.issues[0].message);
  }

  const { game_name, tag_line, region } = parsed.data;

  const parseGameName = (name: string, defaultTag: string) => {
    if (name.includes("#")) {
      const [splitName, splitTag] = name.split("#");
      return { gameName: splitName, tagLine: splitTag || defaultTag };
    }
    return { gameName: name, tagLine: defaultTag };
  };

  const { gameName: finalGameName, tagLine: finalTagLine } = parseGameName(
    game_name,
    tag_line,
  );

  const db = drizzle(c.env.DB, { schema });
  const rankResult = await fetchValorantRankWithCache(
    finalGameName,
    finalTagLine,
    userId,
    db,
    c.env.HENRIKDEV_API_KEY,
    { isJoining: false, region },
  );

  if (!rankResult.success || !rankResult.account) {
    return c.res(`エラー: ${rankResult.error ?? "アカウントが見つかりません"}`);
  }

  const cacheMessage = rankResult.fromCache ? " (キャッシュ)" : "";

  return c.res(
    `アカウントを登録しました${cacheMessage}: ${formatRankLabel(rankResult.account)}`,
  );
};

export const handlerRiotAccountRemove = async (
  c: CommandContext<{ Bindings: Env }>,
) => {
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";
  const options =
    isChatInputData(c.interaction.data) &&
    c.interaction.data.options[0]?.options
      ? c.interaction.data.options[0].options
      : [];

  if (!userId) {
    return c.res("エラー: user情報が不足しています");
  }

  const optionsObj = Object.fromEntries(
    options.map((opt) => [opt.name, opt.value]),
  );

  const parsed = v.riotAccountRemoveOptionsSchema.safeParse(optionsObj);

  if (!parsed.success) {
    return c.res(parsed.error.issues[0].message);
  }

  const { game_name, tag_line } = parsed.data;

  const db = drizzle(c.env.DB, { schema });

  if (game_name && tag_line) {
    await db
      .delete(schema.riotAccounts)
      .where(
        and(
          eq(schema.riotAccounts.userId, userId),
          eq(schema.riotAccounts.gameName, game_name),
          eq(schema.riotAccounts.tagLine, tag_line),
        ),
      );

    return c.res(`アカウントを削除しました: ${game_name}#${tag_line}`);
  }

  await db
    .delete(schema.riotAccounts)
    .where(eq(schema.riotAccounts.userId, userId));

  return c.res("全てのアカウントを削除しました");
};

export const handlerRiotAccountList = async (
  c: CommandContext<{ Bindings: Env }>,
) => {
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";

  if (!userId) {
    return c.res("エラー: user情報が不足しています");
  }

  const db = drizzle(c.env.DB, { schema });

  const accounts = await db
    .select()
    .from(schema.riotAccounts)
    .where(eq(schema.riotAccounts.userId, userId))
    .all();

  if (accounts.length === 0) {
    return c.res("登録されているアカウントはありません");
  }

  const accountList = accounts
    .map((acc) => `- ${acc.gameName}#${acc.tagLine} (${acc.rank})`)
    .join("\n");

  return c.res(`登録されているアカウント:\n${accountList}`);
};
