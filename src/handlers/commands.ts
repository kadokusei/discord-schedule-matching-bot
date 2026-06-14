import type {
  APIApplicationCommandAutocompleteInteraction,
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
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { deleteDiscordMessage, editOriginalInteractionResponse } from "../features/discord";
import {
  buildRefreshSummary,
  buildRiotAddOutcome,
  fetchValorantRankWithCache,
  refreshUserRanks,
} from "../features/riot";
import { canManageSchedule } from "../shared/discord/permissions";
import { MAX_TIME_OPTIONS, timeOptionCount } from "../shared/time";
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

/** /schedule の使い方（register-commands.ts の定義と内容を揃える） */
const SCHEDULE_HELP = [
  "📅 **schedule コマンドの使い方**",
  "",
  "▸ **/schedule create** — 募集スケジュールを作成します",
  "　・post_time（必須）: 投稿時間（HH:MM形式）例: 20:00",
  "　・interval（任意）: 募集枠の間隔（分）省略時はサーバー設定 or 30分",
  "　・duration（任意）: 募集期間（分）省略時はサーバー設定 or 360分",
  "　例) /schedule create post_time:20:00 interval:60 duration:180",
  "",
  "▸ **/schedule settings** — サーバー設定を変更します",
  "　・timezone（必須）: タイムゾーン 例: Asia/Tokyo",
  "　例) /schedule settings timezone:Asia/Tokyo",
  "",
  "▸ **/schedule list** — 登録済みの定期予定を一覧表示します",
  "　引数はありません。",
  "",
  "▸ **/schedule delete** — 定期予定を削除します",
  "　・id（必須）: 削除する定期予定（入力時に候補から選択できます）",
  "　※ 削除できるのは作成者本人またはサーバー管理者のみです。関連する募集メッセージも削除されます。",
  "",
  "▸ **/schedule help** — このヘルプを表示します",
].join("\n");

/** /riot の使い方（register-commands.ts の定義と内容を揃える） */
const RIOT_HELP = [
  "🎮 **riot コマンドの使い方**",
  "",
  "▸ **/riot add** — VALORANTアカウントを追加します",
  "　・game_name（必須）: ゲーム名（「名前#タグ」のように # を含めて指定も可）",
  "　・tag_line（任意）: タグライン（game_name に # を含めない場合は必須）",
  "　・region（任意）: リージョン（ap / na / eu / kr / latam / br）",
  "　例) /riot add game_name:Player#JP1",
  "　例) /riot add game_name:Player tag_line:JP1 region:ap",
  "",
  "▸ **/riot remove** — VALORANTアカウントを削除します",
  "　・game_name（任意）/ tag_line（任意）: 両方指定でそのアカウントのみ削除",
  "　※ 両方とも省略すると、登録済みの全アカウントを削除します。",
  "　例) /riot remove game_name:Player tag_line:JP1",
  "",
  "▸ **/riot list** — 登録済みのVALORANTアカウントを一覧表示します",
  "　引数はありません。",
  "",
  "▸ **/riot refresh** — 登録済みのVALORANTアカウントのランクを再取得します",
  "　引数はありません。最新のランクを Riot から取り直します（キャッシュは無視します）。",
  "",
  "▸ **/riot help** — このヘルプを表示します",
].join("\n");

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
    if (sub?.name === "help") return ephemeral(SCHEDULE_HELP);
    if (sub?.name === "create") return handleScheduleCreate(interaction, sub.options, env);
    if (sub?.name === "settings") return handleScheduleSettings(interaction, sub.options, env);
    if (sub?.name === "list") return handleScheduleList(interaction, env);
    if (sub?.name === "delete") return handleScheduleDelete(interaction, sub.options, env);
  }

  if (data.name === "riot") {
    if (sub?.name === "help") return ephemeral(RIOT_HELP);
    if (sub?.name === "add") return handleRiotAccountAdd(interaction, sub.options, env, ctx);
    if (sub?.name === "remove") return handleRiotAccountRemove(interaction, sub.options, env);
    if (sub?.name === "list") return handleRiotAccountList(interaction, env);
    if (sub?.name === "refresh") return handleRiotAccountRefresh(interaction, env, ctx);
  }

  return ephemeral("エラー: 不明なコマンドです");
};

/** APPLICATION_COMMAND_AUTOCOMPLETE のディスパッチ（/schedule delete の id 候補のみ提供） */
export const handleAutocomplete = async (
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> => {
  const emptyResult: APIInteractionResponse = {
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: { choices: [] },
  };

  const guildId = interaction.guild_id;
  const data = interaction.data;
  const sub = data.options?.find((o) => o.type === ApplicationCommandOptionType.Subcommand);

  if (data.name !== "schedule" || sub?.name !== "delete" || !guildId) {
    return emptyResult;
  }

  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.guildId, guildId))
    .all();

  // Discord のオートコンプリート候補は最大25件
  const choices = rows.slice(0, 25).map((s) => ({
    name: describeSchedule(s),
    value: s.id,
  }));

  return {
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: { choices },
  };
};

const handleScheduleCreate = async (
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

  // 時間選択メニュー（StringSelect）は時間スロット + 「未定」1件で構成され、合計は Discord 上限(25)以内に収める。
  // 時間スロット数が 24 を超える設定は作成させない。
  const menuOptionCount = timeOptionCount(resolvedInterval, resolvedDuration) + 1;
  if (menuOptionCount > MAX_TIME_OPTIONS) {
    return ephemeral(
      `エラー: 時間の選択肢が多すぎます（間隔 ${resolvedInterval}分 / 期間 ${resolvedDuration}分 → 「未定」を含め ${menuOptionCount}個）。選択肢は「未定」を含め ${MAX_TIME_OPTIONS}個までです。間隔を広げるか期間を短くしてください。`,
    );
  }

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

/** 定期予定の説明文（一覧・オートコンプリート共通）。active=0 は停止中として明示。 */
const describeSchedule = (s: schema.Schedule): string =>
  `${s.postTimeHHmm} (間隔${s.intervalMin}分 / 期間${s.durationMin}分)${s.active ? "" : " [停止中]"}`;

const handleScheduleList = async (
  interaction: APIApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> => {
  const guildId = interaction.guild_id;

  if (!guildId) {
    return ephemeral("エラー: guild情報が不足しています");
  }

  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.guildId, guildId))
    .all();

  if (rows.length === 0) {
    return ephemeral("登録されている定期予定はありません");
  }

  const lines = rows.map((s) => `- ${describeSchedule(s)} 作成者: <@${s.creatorId}>`);

  return ephemeral(`登録されている定期予定 (${rows.length}件):\n${lines.join("\n")}`);
};

const handleScheduleDelete = async (
  interaction: APIApplicationCommandInteraction,
  options: APIApplicationCommandInteractionDataOption[],
  env: Env,
): Promise<APIInteractionResponse> => {
  const guildId = interaction.guild_id;

  if (!guildId) {
    return ephemeral("エラー: guild情報が不足しています");
  }

  const parsed = v.scheduleDeleteOptionsSchema.safeParse(optionsToObject(options));
  if (!parsed.success) {
    return ephemeral(parsed.error.issues[0].message);
  }

  const { id } = parsed.data;
  const db = drizzle(env.DB, { schema });

  // guild 内の予定のみ対象
  const schedule = await db
    .select()
    .from(schema.schedules)
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.guildId, guildId)))
    .get();

  if (!schedule) {
    return ephemeral("エラー: 指定された定期予定が見つかりません");
  }

  // 認可: 作成者本人またはサーバー管理者(ManageGuild/Administrator)のみ削除可
  if (
    !canManageSchedule({
      invokerId: getUserId(interaction),
      creatorId: schedule.creatorId,
      memberPermissions: interaction.member?.permissions,
    })
  ) {
    return ephemeral(
      "エラー: この定期予定を削除する権限がありません（作成者またはサーバー管理者のみ）",
    );
  }

  const relatedRecruits = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.scheduleId, id))
    .all();

  // open な募集は Discord メッセージを削除（失敗してもDB削除は継続）
  for (const recruit of relatedRecruits) {
    if (recruit.status === "open" && recruit.messageId) {
      try {
        await deleteDiscordMessage(env, recruit.channelId, recruit.messageId);
      } catch (error) {
        console.error(
          `[SCHEDULE_DELETE] Failed to delete message for recruit ${recruit.id}:`,
          error,
        );
      }
    }
  }

  // 参照整合性のため entries → recruits → schedule の順で物理削除
  const recruitIds = relatedRecruits.map((r) => r.id);
  if (recruitIds.length > 0) {
    await db
      .delete(schema.recruitEntries)
      .where(inArray(schema.recruitEntries.recruitId, recruitIds));
  }
  await db.delete(schema.recruits).where(eq(schema.recruits.scheduleId, id));
  await db.delete(schema.schedules).where(eq(schema.schedules.id, id));

  return ephemeral(`定期予定を削除しました: ${schedule.postTimeHHmm}`);
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

          // 上流APIの生エラーはユーザーに出さず、汎用文言＋ログに分離する
          const outcome = buildRiotAddOutcome(rankResult);
          if (outcome.logDetail) {
            console.error("[RIOT_ADD] fetch failed:", outcome.logDetail);
          }
          return outcome.message;
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

const handleRiotAccountRefresh = async (
  interaction: APIApplicationCommandInteraction,
  env: Env,
  ctx: WaitUntilContext,
): Promise<APIInteractionResponse> => {
  const userId = getUserId(interaction);

  if (!userId) {
    return ephemeral("エラー: user情報が不足しています");
  }

  // 全アカウントの実 API 再取得は3秒を超え得るため deferred 化し、結果は @original で反映
  ctx.waitUntil(
    (async () => {
      const content = await (async () => {
        try {
          const db = drizzle(env.DB, { schema });
          // cacheDurationMs: 0 でキャッシュを強制バイパスし、最新ランクを取り直す
          const results = await refreshUserRanks(userId, db, env.HENRIKDEV_API_KEY, {
            cacheDurationMs: 0,
          });
          if (results.length === 0) {
            return "登録されているアカウントはありません";
          }
          return buildRefreshSummary(results);
        } catch (error) {
          console.error("[RIOT_REFRESH] Failed:", error);
          return "エラー: ランクの再取得中に問題が発生しました";
        }
      })();

      try {
        await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, {
          content,
        });
      } catch (error) {
        console.error("[RIOT_REFRESH] Failed to edit original response:", error);
      }
    })(),
  );

  return deferredEphemeral();
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
