import type {
  APIInteractionResponse,
  APIInteractionResponseCallbackData,
  APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { ComponentType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { editOriginalInteractionResponse } from "../features/discord";
import { applyConsent, isRecruitActive } from "../features/recruit";
import { refreshUserRanks } from "../features/riot";
import { buildTimeOptions } from "../shared/time";
import type { Env, WaitUntilContext } from "../lib/types";
import { finalizeSmallParty, recomputeMatch } from "./matching";

const getUserId = (interaction: APIMessageComponentInteraction): string =>
  interaction.member?.user?.id ?? interaction.user?.id ?? "";

const getSelectedValue = (interaction: APIMessageComponentInteraction): string | undefined => {
  const data = interaction.data;
  if (data.component_type === ComponentType.StringSelect && data.values.length > 0) {
    return data.values[0];
  }
  return undefined;
};

/** ephemeral deferred 応答（押したユーザー本人にだけ loading を見せる） */
const deferredEphemeral = (): APIInteractionResponse => ({
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MessageFlags.Ephemeral },
});

/** 終端状態の募集に対する操作を弾くときの定型メッセージ。 */
const RECRUIT_CLOSED_MESSAGE = "この募集は終了しているため、操作できません。";

/** @original を編集して結果を本人に反映。失敗時はログのみ。 */
const respond = async (
  env: Env,
  interaction: APIMessageComponentInteraction,
  body: APIInteractionResponseCallbackData,
): Promise<void> => {
  try {
    await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, body);
  } catch (error) {
    console.error("[COMPONENT] Failed to edit original response:", error);
  }
};

/** MESSAGE_COMPONENT のディスパッチ。常に ephemeral deferred を即返し、本処理は waitUntil。 */
export const handleComponentInteraction = (
  interaction: APIMessageComponentInteraction,
  env: Env,
  ctx: WaitUntilContext,
): APIInteractionResponse => {
  const [, action, recruitId] = interaction.data.custom_id.split(":");

  ctx.waitUntil(
    (async () => {
      try {
        switch (action) {
          case "join":
            await handleRecruitJoin(interaction, recruitId, env);
            break;
          case "time":
            await handleRecruitTime(interaction, recruitId, env);
            break;
          case "cancel":
            await handleRecruitCancel(interaction, recruitId, env);
            break;
          case "party_confirm":
            await handleSmallPartyConfirm(interaction, recruitId, env);
            break;
          default:
            await respond(env, interaction, { content: "エラー: 不明な操作です" });
        }
      } catch (error) {
        console.error(`[COMPONENT] Unhandled error for action ${action}:`, error);
        await respond(env, interaction, {
          content: "エラー: 処理中に問題が発生しました",
        });
      }
    })(),
  );

  return deferredEphemeral();
};

const handleRecruitJoin = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = getUserId(interaction);

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const db = drizzle(env.DB, { schema });
  const nowUtc = new Date().toISOString();

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  if (!recruit) {
    await respond(env, interaction, { content: "エラー: 募集が見つかりません" });
    return;
  }

  if (!isRecruitActive(recruit.status)) {
    await respond(env, interaction, { content: RECRUIT_CLOSED_MESSAGE });
    return;
  }

  const schedule = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, recruit.scheduleId))
    .get();

  const settings = await db
    .select()
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, recruit.guildId))
    .get();

  const intervalMin = schedule?.intervalMin ?? settings?.defaultIntervalMin ?? 30;
  const durationMin = schedule?.durationMin ?? settings?.defaultDurationMin ?? 360;
  const timezone = settings?.timezone ?? "Asia/Tokyo";

  const timeOptions = buildTimeOptions(
    recruit.targetDateLocal,
    schedule?.postTimeHHmm ?? "20:00",
    intervalMin,
    durationMin,
    timezone,
  );

  await db
    .insert(schema.recruitEntries)
    .values({
      recruitId,
      userId,
      state: "pending_time",
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [schema.recruitEntries.recruitId, schema.recruitEntries.userId],
      set: {
        state: "pending_time",
        availableFromUtc: null,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      },
    });

  // 公開募集メッセージの Embed を更新（参加状況の反映は recomputeMatch に一本化）
  await recomputeMatch(env, recruitId, userId);

  // 本人にだけ時間選択セレクトを ephemeral で提示
  await respond(env, interaction, {
    content: "参加登録しました。希望時間を選んでください。",
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: `recruit:time:${recruitId}`,
            placeholder: "希望時間を選択",
            options: timeOptions.map((opt) => ({ label: opt.label, value: opt.value })),
            min_values: 1,
            max_values: 1,
          },
        ],
      },
    ],
  });

  // ランク再取得はベストエフォート（失敗してもマッチングは継続）
  await updateAllUserRanks(userId, db, env.HENRIKDEV_API_KEY);
};

const handleRecruitTime = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = getUserId(interaction);
  const selectedTime = getSelectedValue(interaction);

  if (!recruitId || !userId || !selectedTime) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const db = drizzle(env.DB, { schema });
  const nowUtc = new Date().toISOString();

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  if (!recruit) {
    await respond(env, interaction, { content: "エラー: 募集が見つかりません" });
    return;
  }

  if (!isRecruitActive(recruit.status)) {
    await respond(env, interaction, { content: RECRUIT_CLOSED_MESSAGE });
    return;
  }

  const settings = await db
    .select()
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, recruit.guildId))
    .get();

  const timezone = settings?.timezone ?? "Asia/Tokyo";

  await db
    .insert(schema.recruitEntries)
    .values({
      recruitId,
      userId,
      state: "confirmed",
      availableFromUtc: selectedTime,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [schema.recruitEntries.recruitId, schema.recruitEntries.userId],
      set: {
        state: "confirmed",
        availableFromUtc: selectedTime,
        updatedAtUtc: nowUtc,
      },
    });

  await recomputeMatch(env, recruitId, userId);

  const localTime = new Date(selectedTime).toLocaleString("ja-JP", { timeZone: timezone });
  await respond(env, interaction, {
    content: `希望時間を登録しました: ${localTime}`,
    components: [],
  });
};

const handleRecruitCancel = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = getUserId(interaction);

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const db = drizzle(env.DB, { schema });

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  if (!recruit) {
    await respond(env, interaction, { content: "エラー: 募集が見つかりません" });
    return;
  }

  if (!isRecruitActive(recruit.status)) {
    await respond(env, interaction, { content: RECRUIT_CLOSED_MESSAGE });
    return;
  }

  await db
    .delete(schema.recruitEntries)
    .where(
      and(eq(schema.recruitEntries.recruitId, recruitId), eq(schema.recruitEntries.userId, userId)),
    );

  await recomputeMatch(env, recruitId, userId);

  await respond(env, interaction, { content: "参加を取り消しました。", components: [] });
};

const parseJsonArray = (json: string | null): string[] => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

const handleSmallPartyConfirm = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = getUserId(interaction);

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const db = drizzle(env.DB, { schema });

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  if (!recruit) {
    await respond(env, interaction, { content: "エラー: 募集が見つかりません" });
    return;
  }

  if (!isRecruitActive(recruit.status)) {
    await respond(env, interaction, { content: RECRUIT_CLOSED_MESSAGE });
    return;
  }

  if (recruit.smallPartyStatus !== "proposed") {
    await respond(env, interaction, { content: "この確定提案は現在有効ではありません。" });
    return;
  }

  const memberIds = parseJsonArray(recruit.smallPartyMemberIdsJson);
  const currentConsent = parseJsonArray(recruit.smallPartyConsentJson);

  const result = applyConsent(memberIds, currentConsent, userId);

  if (!result.isMember) {
    await respond(env, interaction, {
      content: "あなたはこの確定の対象メンバーではありません。",
    });
    return;
  }

  await db
    .update(schema.recruits)
    .set({ smallPartyConsentJson: JSON.stringify(result.consent) })
    .where(eq(schema.recruits.id, recruitId));

  if (result.allConfirmed) {
    await finalizeSmallParty(env, recruitId, userId);
    await respond(env, interaction, { content: "全員の同意が揃いました。確定しました！" });
    return;
  }

  const remaining = memberIds.length - result.consent.length;
  await respond(env, interaction, {
    content: `同意しました。残り ${remaining} 人の同意待ちです。`,
  });
};

type RankUpdateResult =
  | { success: true; accountCount: number; failedCount: number }
  | { success: false; error: string };

const updateAllUserRanks = async (
  userId: string,
  db: DrizzleD1Database<typeof schema>,
  apiKey: string,
): Promise<RankUpdateResult> => {
  // 参加時の再取得は短いキャッシュ（5分）越えのみ実 API を叩く（isJoining: true）。
  const results = await refreshUserRanks(userId, db, apiKey, { isJoining: true });

  const accountCount = results.length;
  const failedCount = results.filter((r) => !r.result.success).length;

  if (failedCount > 0) {
    console.warn(
      `[RANK_UPDATE] ${failedCount}/${accountCount} accounts failed to update for user ${userId}`,
    );
  }

  return { success: true, accountCount, failedCount };
};
