import type {
  APIInteractionResponse,
  APIInteractionResponseCallbackData,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { ComponentType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { editOriginalInteractionResponse } from "../features/discord";
import {
  PARTY_SIZE_PREFERENCES,
  isPartySizePreference,
  isRecruitActive,
  partySizePreferenceLabel,
} from "../features/recruit";
import { refreshUserRanks } from "../features/riot";
import { buildTimeOptions } from "../shared/time";
import type { Env, WaitUntilContext } from "../lib/types";
import { recomputeMatch } from "./matching";

/** discord-api-types に Label が無いため local constant で拘束する（Discord API type 18）。 */
const ComponentTypeLabel = 18 as const;

/** ephemeral deferred 応答（押したユーザー本人にだけ loading を見せる） */
const deferredEphemeral = (): APIInteractionResponse => ({
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MessageFlags.Ephemeral },
});

/** ephemeral な即時メッセージ応答（Modal を開けないエラー時など）。 */
const ephemeralMessage = (content: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
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

/**
 * 「登録・更新」ボタンが開く Modal の応答ペイロード。
 * 希望パーティサイズと希望時間をともに string select で選ばせ、Submit で 1 リクエスト確定する。
 * 募集が操作不可なら Modal ではなく ephemeral エラーを返す。
 */
const buildRegisterModalResponse = async (
  env: Env,
  recruitId: string,
): Promise<APIInteractionResponse> => {
  const db = drizzle(env.DB, { schema });
  const context = await loadActiveRecruitContext(db, recruitId);
  if (typeof context === "string") {
    return ephemeralMessage(context);
  }

  const timeOptions = buildTimeOptions(
    context.recruit.targetDateLocal,
    context.schedule.postTimeHHmm,
    context.schedule.intervalMin,
    context.schedule.durationMin,
    context.timezone,
  );

  return {
    type: InteractionResponseType.Modal,
    data: {
      custom_id: `recruit:register-modal:${recruitId}`,
      title: "参加登録・更新",
      components: [
        {
          type: ComponentTypeLabel,
          label: "希望するパーティサイズ",
          component: {
            type: ComponentType.StringSelect,
            custom_id: "party_size_preference",
            options: PARTY_SIZE_PREFERENCES.map((value) => ({
              label: partySizePreferenceLabel(value),
              value,
            })),
            min_values: 1,
            max_values: 1,
            required: true,
          },
        },
        {
          type: ComponentTypeLabel,
          label: "希望時間",
          component: {
            type: ComponentType.StringSelect,
            custom_id: "available_time",
            options: timeOptions.map((opt) => ({ label: opt.label, value: opt.value })),
            min_values: 1,
            max_values: 1,
            required: true,
          },
        },
      ],
    },
  } as APIInteractionResponse;
};

/** MESSAGE_COMPONENT のディスパッチ。「登録・更新」は Modal を同期応答、それ以外は deferred + waitUntil。 */
export const handleComponentInteraction = async (
  interaction: APIMessageComponentInteraction,
  env: Env,
  ctx: WaitUntilContext,
): Promise<APIInteractionResponse> => {
  const [, action, recruitId] = interaction.data.custom_id.split(":");

  // 「登録・更新」ボタンは Modal を同期的に返す（deferred 不可）
  if (action === "register") {
    return await buildRegisterModalResponse(env, recruitId);
  }

  ctx.waitUntil(
    (async () => {
      try {
        switch (action) {
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

/** MODAL_SUBMIT のディスパッチ。常に ephemeral deferred を即返し、本処理は waitUntil。 */
export const handleModalSubmitInteraction = (
  interaction: APIModalSubmitInteraction,
  env: Env,
  ctx: WaitUntilContext,
): APIInteractionResponse => {
  const customId = interaction.data.custom_id;
  const [, action, recruitId] = customId.split(":");

  if (action !== "register-modal") {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: "エラー: 不明な操作です", flags: MessageFlags.Ephemeral },
    };
  }

  ctx.waitUntil(
    (async () => {
      try {
        await handleRecruitRegistration(interaction, recruitId, env);
      } catch (error) {
        console.error(`[MODAL] Unhandled error for custom_id ${customId}:`, error);
        await respond(env, interaction, { content: "エラー: 処理中に問題が発生しました" });
      }
    })(),
  );

  return deferredEphemeral();
};

/**
 * Modal submit の components 配列を再帰走査し、custom_id → value/values[0] を集める。
 * Discord は Label 形式 { type: 18, component: ... } と旧 ActionRow 形式 { components: [...] }
 * の両方を返しうるため、どちらも辿れるようにする。string select は values[0] を採用する。
 */
type ModalNode = {
  custom_id?: string;
  value?: string;
  values?: string[];
  components?: unknown[];
  component?: unknown;
};

const extractModalFields = (components: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const field = node as ModalNode;
    if (field.custom_id && (field.value !== undefined || Array.isArray(field.values))) {
      result[field.custom_id] = field.values?.[0] ?? field.value ?? "";
    }
    if (Array.isArray(field.components)) {
      for (const child of field.components) visit(child);
    }
    if (field.component) visit(field.component);
  };
  if (Array.isArray(components)) {
    for (const child of components) visit(child);
  }
  return result;
};

/** Modal submit: 希望パーティサイズと希望時間を検証して recruit_entries へ確定する（1 リクエスト）。 */
const handleRecruitRegistration = async (
  interaction: APIModalSubmitInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  const fields = extractModalFields(interaction.data.components as unknown);
  const partySizePreferenceRaw = fields["party_size_preference"];
  const availableFromUtc = fields["available_time"] ?? "";

  if (!recruitId || !userId) {
    await respond(env, interaction, { content: "エラー: 必要な情報が不足しています" });
    return;
  }

  if (!isPartySizePreference(partySizePreferenceRaw)) {
    await respond(env, interaction, {
      content: "エラー: 希望するパーティサイズを選択してください",
    });
    return;
  }
  const partySizePreference = partySizePreferenceRaw;

  const db = drizzle(env.DB, { schema });
  const context = await loadActiveRecruitContext(db, recruitId);
  if (typeof context === "string") {
    await respond(env, interaction, { content: context });
    return;
  }

  // 希望時間 select の value（ISO8601）が現在の募集時間内候補に含まれることを検証する。
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
      set: {
        availableFromUtc,
        partySizePreference,
        updatedAtUtc: nowUtc,
      },
    });

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

/** キャンセル: 確定参加を削除する。 */
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
