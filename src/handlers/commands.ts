import type {
  APIApplicationCommandInteraction,
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteractionData,
  APIInteractionResponse,
} from "discord-api-types/v10";
import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  MessageFlags,
} from "discord-api-types/v10";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { editOriginalInteractionResponse } from "../features/discord";
import { fetchValorantRankWithCache, formatRankLabel } from "../features/riot";
import type { Env, WaitUntilContext } from "../lib/types";
import * as v from "../shared/validation";

type OptionValue = string | number | boolean;
type FlatOptions = Record<string, OptionValue>;

/** ephemeral なメッセージ応答（コマンド結果はチャンネルを汚さないよう本人のみ表示） */
const ephemeral = (content: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

/** ephemeral deferred 応答（外部 I/O を伴うコマンド用） */
const deferredEphemeral = (): APIInteractionResponse => ({
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MessageFlags.Ephemeral },
});

const getUserId = (interaction: APIApplicationCommandInteraction): string =>
  interaction.member?.user?.id ?? interaction.user?.id ?? "";

/** サブコマンドとそのオプションを取り出す */
const getSubcommand = (
  data: APIChatInputApplicationCommandInteractionData,
): { name: string; options: APIApplicationCommandInteractionDataOption[] } | null => {
  const sub = data.options?.find((o) => o.type === ApplicationCommandOptionType.Subcommand);
  if (!sub || sub.type !== ApplicationCommandOptionType.Subcommand) {
    return null;
  }
  return { name: sub.name, options: sub.options ?? [] };
};

const optionsToObject = (options: APIApplicationCommandInteractionDataOption[]): FlatOptions =>
  Object.fromEntries(
    options
      .filter((o): o is Extract<typeof o, { value: OptionValue }> => "value" in o)
      .map((o) => [o.name, o.value]),
  );

/** APPLICATION_COMMAND のディスパッチ */
export const handleCommandInteraction = async (
  interaction: APIApplicationCommandInteraction,
  env: Env,
  ctx: WaitUntilContext,
): Promise<APIInteractionResponse> => {
  const data = interaction.data as APIChatInputApplicationCommandInteractionData;
  const sub = getSubcommand(data);

  if (data.name === "schedule") {
    if (sub?.name === "recruit") return handleScheduleRecruit(interaction, sub.options, env);
    if (sub?.name === "settings") return handleScheduleSettings(interaction, sub.options, env);
  }

  if (data.name === "riot") {
    if (sub?.name === "add") return handleRiotAccountAdd(interaction, sub.options, env, ctx);
    if (sub?.name === "remove") return handleRiotAccountRemove(interaction, sub.options, env);
    if (sub?.name === "list") return handleRiotAccountList(interaction, env);
  }

  return ephemeral("エラー: 不明なコマンドです");
};

const handleScheduleRecruit = async (
  interaction: APIApplicationCommandInteraction,
  options: APIApplicationCommandInteractionDataOption[],
  env: Env,
): Promise<APIInteractionResponse> => {
  const guildId = interaction.guild_id;
  const channelId = interaction.channel?.id;
  const creatorId = getUserId(interaction);

  const parsed = v.recruitOptionsSchema.safeParse(optionsToObject(options));
  if (!parsed.success) {
    return ephemeral(parsed.error.issues[0].message);
  }

  const { post_time, interval, duration } = parsed.data;

  if (!guildId || !channelId || !creatorId) {
    return ephemeral("エラー: guild/channel/user情報が不足しています");
  }

  const db = drizzle(env.DB, { schema });
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

  return ephemeral(
    `スケジュールを作成しました: ${post_time} (間隔 ${resolvedInterval}分 / ${resolvedDuration}分)`,
  );
};

const handleScheduleSettings = async (
  interaction: APIApplicationCommandInteraction,
  options: APIApplicationCommandInteractionDataOption[],
  env: Env,
): Promise<APIInteractionResponse> => {
  const guildId = interaction.guild_id;

  if (!guildId) {
    return ephemeral("エラー: guild情報が不足しています");
  }

  const parsed = v.settingsOptionsSchema.safeParse(optionsToObject(options));
  if (!parsed.success) {
    return ephemeral(parsed.error.issues[0].message);
  }

  const { timezone } = parsed.data;
  const db = drizzle(env.DB, { schema });

  await db
    .insert(schema.guildSettings)
    .values({
      id: crypto.randomUUID(),
      guildId,
      timezone,
    })
    .onConflictDoUpdate({
      target: schema.guildSettings.guildId,
      set: { timezone },
    });

  return ephemeral(`タイムゾーンを ${timezone} に設定しました`);
};

const parseGameName = (name: string, defaultTag?: string) => {
  if (name.includes("#")) {
    const [splitName, splitTag] = name.split("#");
    return { gameName: splitName, tagLine: splitTag || defaultTag || "" };
  }
  return { gameName: name, tagLine: defaultTag || "" };
};

const handleRiotAccountAdd = async (
  interaction: APIApplicationCommandInteraction,
  options: APIApplicationCommandInteractionDataOption[],
  env: Env,
  ctx: WaitUntilContext,
): Promise<APIInteractionResponse> => {
  const userId = getUserId(interaction);

  if (!userId) {
    return ephemeral("エラー: user情報が不足しています");
  }

  const parsed = v.riotAccountAddOptionsSchema.safeParse(optionsToObject(options));
  if (!parsed.success) {
    return ephemeral(parsed.error.issues[0].message);
  }

  const { game_name, tag_line, region } = parsed.data;

  // HenrikDev API 呼び出しは3秒を超え得るため deferred 化し、結果は @original で反映
  ctx.waitUntil(
    (async () => {
      const content = await (async () => {
        try {
          const { gameName, tagLine } = parseGameName(game_name, tag_line);
          const db = drizzle(env.DB, { schema });
          const rankResult = await fetchValorantRankWithCache(
            gameName,
            tagLine,
            userId,
            db,
            env.HENRIKDEV_API_KEY,
            { isJoining: false, region },
          );

          if (!rankResult.success || !rankResult.account) {
            return `エラー: ${rankResult.error ?? "アカウントが見つかりません"}`;
          }

          const cacheMessage = rankResult.fromCache ? " (キャッシュ)" : "";
          return `アカウントを登録しました${cacheMessage}: ${formatRankLabel(rankResult.account)}`;
        } catch (error) {
          console.error("[RIOT_ADD] Failed:", error);
          return "エラー: アカウント登録中に問題が発生しました";
        }
      })();

      try {
        await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, {
          content,
        });
      } catch (error) {
        console.error("[RIOT_ADD] Failed to edit original response:", error);
      }
    })(),
  );

  return deferredEphemeral();
};

const handleRiotAccountRemove = async (
  interaction: APIApplicationCommandInteraction,
  options: APIApplicationCommandInteractionDataOption[],
  env: Env,
): Promise<APIInteractionResponse> => {
  const userId = getUserId(interaction);

  if (!userId) {
    return ephemeral("エラー: user情報が不足しています");
  }

  const parsed = v.riotAccountRemoveOptionsSchema.safeParse(optionsToObject(options));
  if (!parsed.success) {
    return ephemeral(parsed.error.issues[0].message);
  }

  const { game_name, tag_line } = parsed.data;
  const db = drizzle(env.DB, { schema });

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

    return ephemeral(`アカウントを削除しました: ${game_name}#${tag_line}`);
  }

  await db.delete(schema.riotAccounts).where(eq(schema.riotAccounts.userId, userId));

  return ephemeral("全てのアカウントを削除しました");
};

const handleRiotAccountList = async (
  interaction: APIApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> => {
  const userId = getUserId(interaction);

  if (!userId) {
    return ephemeral("エラー: user情報が不足しています");
  }

  const db = drizzle(env.DB, { schema });

  const accounts = await db
    .select()
    .from(schema.riotAccounts)
    .where(eq(schema.riotAccounts.userId, userId))
    .all();

  if (accounts.length === 0) {
    return ephemeral("登録されているアカウントはありません");
  }

  const accountList = accounts
    .map((acc) => `- ${acc.gameName}#${acc.tagLine} (${formatStoredRank(acc.rank)})`)
    .join("\n");

  return ephemeral(`登録されているアカウント:\n${accountList}`);
};

/** DB に JSON 文字列で保存された rank から表示用ラベルを取り出す */
const formatStoredRank = (rankJson: string): string => {
  if (!rankJson) return "Unrated";
  try {
    const parsed = JSON.parse(rankJson) as { rank?: string };
    return parsed.rank ?? "Unrated";
  } catch {
    return "Unrated";
  }
};
