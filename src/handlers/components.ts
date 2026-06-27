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
import {
  isPartySizePreference,
  isRecruitActive,
  partySizePreferenceLabel,
} from "../features/recruit";
import { refreshUserRanks } from "../features/riot";
import { buildTimeOptions } from "../shared/time";
import type { Env, WaitUntilContext } from "../lib/types";
import { recomputeMatch } from "./matching";

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
  interaction: { token: string },
  body: APIInteractionResponseCallbackData,
): Promise<void> => {
  try {
    await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, body);
  } catch (error) {
    console.error("[COMPONENT] Failed to edit original interaction response:", error);
  }
};

/** string select の選択値（単一）を取り出す。select でない / 未選択なら undefined。 */
const getSelectedValue = (interaction: APIMessageComponentInteraction): string | undefined => {
  const data = interaction.data;
  if (data.component_type === ComponentType.StringSelect && data.values.length > 0) {
    return data.values[0];
  }
  return undefined;
};

type RecruitContext = {
  recruit: schema.Recruit;
  schedule: schema.Schedule;
  timezone: string;
};

/**
 * 募集が操作可能な状態か検証し、recruit / schedule / timezone をまとめて返す。
 * 失敗時はユーザー向けエラーメッセージ文字列を返す。
 */
const loadActiveRecruitContext = async (
  db: DrizzleD1Database<typeof schema>,
  recruitId: string,
): Promise<RecruitContext | string> => {
  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();
  if (!recruit) return "エラー: 募集が見つかりません";
  if (!isRecruitActive(recruit.status)) return RECRUIT_CLOSED_MESSAGE;

  const schedule = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, recruit.scheduleId))
    .get();
  if (!schedule) return "エラー: スケジュールが見つかりません";

  const settings = await db
    .select()
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, recruit.guildId))
    .get();
  const timezone = settings?.timezone ?? "Asia/Tokyo";

  return { recruit, schedule, timezone };
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
          case "party_size":
            await handleRecruitPartySizeDraft(interaction, recruitId, env);
            break;
          case "time":
            await handleRecruitTimeDraft(interaction, recruitId, env);
            break;
          case "register":
            await handleRecruitRegisterFromDraft(interaction, recruitId, env);
            break;
          case "cancel":
            await handleRecruitCancel(interaction, recruitId, env);
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

/** 希望パーティサイズ select: draft の party_size_preference だけを保存する（確定はしない）。 */
const handleRecruitPartySizeDraft = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const selected = getSelectedValue(interaction);
  if (!isPartySizePreference(selected)) {
    await respond(env, interaction, {
      content: "エラー: 希望するパーティサイズを選択してください",
    });
    return;
  }
  const partySizePreference = selected;

  const db = drizzle(env.DB, { schema });
  const context = await loadActiveRecruitContext(db, recruitId);
  if (typeof context === "string") {
    await respond(env, interaction, { content: context });
    return;
  }

  const nowUtc = new Date().toISOString();
  await db
    .insert(schema.recruitEntryDrafts)
    .values({
      recruitId,
      userId,
      partySizePreference,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [schema.recruitEntryDrafts.recruitId, schema.recruitEntryDrafts.userId],
      set: { partySizePreference, updatedAtUtc: nowUtc },
    });

  await respond(env, interaction, {
    content: `希望パーティサイズを選択しました: ${partySizePreferenceLabel(partySizePreference)}。「登録・更新」を押すと確定します。`,
  });
};

/** 希望時間 select: draft の available_from_utc だけを保存する（確定はしない）。 */
const handleRecruitTimeDraft = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const selected = getSelectedValue(interaction);
  if (!selected) {
    await respond(env, interaction, { content: "エラー: 希望時間を選択してください" });
    return;
  }

  const db = drizzle(env.DB, { schema });
  const context = await loadActiveRecruitContext(db, recruitId);
  if (typeof context === "string") {
    await respond(env, interaction, { content: context });
    return;
  }

  const timeOptions = buildTimeOptions(
    context.recruit.targetDateLocal,
    context.schedule.postTimeHHmm,
    context.schedule.intervalMin,
    context.schedule.durationMin,
    context.timezone,
  );
  const matches = timeOptions.filter((opt) => opt.value === selected);
  if (matches.length === 0) {
    await respond(env, interaction, {
      content: "エラー: 希望時間は募集時間内の候補から選択してください",
    });
    return;
  }
  if (matches.length >= 2) {
    await respond(env, interaction, {
      content: "エラー: 希望時間が複数候補に一致しました。管理者に確認してください",
    });
    return;
  }

  const availableFromUtc = matches[0]!.value;
  const nowUtc = new Date().toISOString();
  await db
    .insert(schema.recruitEntryDrafts)
    .values({
      recruitId,
      userId,
      availableFromUtc,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [schema.recruitEntryDrafts.recruitId, schema.recruitEntryDrafts.userId],
      set: { availableFromUtc, updatedAtUtc: nowUtc },
    });

  const localTime = new Date(availableFromUtc).toLocaleString("ja-JP", {
    timeZone: context.timezone,
  });
  await respond(env, interaction, {
    content: `希望時間を選択しました: ${localTime}。「登録・更新」を押すと確定します。`,
  });
};

/** 「登録・更新」button: draft を検証して recruit_entries へ確定し、draft を削除する。 */
const handleRecruitRegisterFromDraft = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  const db = drizzle(env.DB, { schema });
  const context = await loadActiveRecruitContext(db, recruitId);
  if (typeof context === "string") {
    await respond(env, interaction, { content: context });
    return;
  }

  const draft = await db
    .select()
    .from(schema.recruitEntryDrafts)
    .where(
      and(
        eq(schema.recruitEntryDrafts.recruitId, recruitId),
        eq(schema.recruitEntryDrafts.userId, userId),
      ),
    )
    .get();

  if (!draft || !draft.partySizePreference || !draft.availableFromUtc) {
    await respond(env, interaction, {
      content: "エラー: 希望パーティサイズと希望時間を選択してから登録・更新を押してください",
    });
    return;
  }

  if (!isPartySizePreference(draft.partySizePreference)) {
    await respond(env, interaction, {
      content: "エラー: 希望するパーティサイズを選択してください",
    });
    return;
  }
  const partySizePreference = draft.partySizePreference;
  const availableFromUtc = draft.availableFromUtc;

  // draft 保存後にスケジュールが変わるなどして、希望時間が現在の候補から外れていないか再検証する。
  const timeOptions = buildTimeOptions(
    context.recruit.targetDateLocal,
    context.schedule.postTimeHHmm,
    context.schedule.intervalMin,
    context.schedule.durationMin,
    context.timezone,
  );
  if (!timeOptions.some((opt) => opt.value === availableFromUtc)) {
    await respond(env, interaction, {
      content: "エラー: 希望時間は募集時間内の候補から選択してください",
    });
    return;
  }

  const nowUtc = new Date().toISOString();
  await db
    .insert(schema.recruitEntries)
    .values({
      recruitId,
      userId,
      availableFromUtc,
      partySizePreference,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    })
    .onConflictDoUpdate({
      target: [schema.recruitEntries.recruitId, schema.recruitEntries.userId],
      set: { availableFromUtc, partySizePreference, updatedAtUtc: nowUtc },
    });

  await db
    .delete(schema.recruitEntryDrafts)
    .where(
      and(
        eq(schema.recruitEntryDrafts.recruitId, recruitId),
        eq(schema.recruitEntryDrafts.userId, userId),
      ),
    );

  await recomputeMatch(env, recruitId, userId);

  const localTime = new Date(availableFromUtc).toLocaleString("ja-JP", {
    timeZone: context.timezone,
  });
  await respond(env, interaction, {
    content: `希望時間を登録しました: ${localTime} / 希望パーティサイズ: ${partySizePreferenceLabel(partySizePreference)}`,
  });

  // ランク再取得はベストエフォート（失敗してもマッチングは継続）
  await updateAllUserRanks(userId, db, env.HENRIKDEV_API_KEY);
};

/** キャンセル: 確定参加と draft の両方を削除する。確定参加が無く draft だけでも取消扱いにする。 */
const handleRecruitCancel = async (
  interaction: APIMessageComponentInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";

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
  await db
    .delete(schema.recruitEntryDrafts)
    .where(
      and(
        eq(schema.recruitEntryDrafts.recruitId, recruitId),
        eq(schema.recruitEntryDrafts.userId, userId),
      ),
    );

  await recomputeMatch(env, recruitId, userId);

  await respond(env, interaction, { content: "参加を取り消しました。", components: [] });
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
