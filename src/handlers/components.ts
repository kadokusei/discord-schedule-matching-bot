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

/** 「登録・更新」ボタンが開く Modal の応答ペイロード。 */
const buildRegisterModalResponse = (recruitId: string): APIInteractionResponse =>
  ({
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
            options: [
              { label: "なんでも", value: "any" },
              { label: "フルパ", value: "full_party" },
              { label: "トリオまで", value: "up_to_trio" },
            ],
            min_values: 1,
            max_values: 1,
            required: true,
          },
        },
        {
          type: ComponentTypeLabel,
          label: "希望時間",
          component: {
            type: ComponentType.TextInput,
            custom_id: "available_time",
            style: 1,
            placeholder: "例: 20:30",
            required: true,
            min_length: 5,
            max_length: 5,
          },
        },
      ],
    },
  }) as APIInteractionResponse;

/** MESSAGE_COMPONENT のディスパッチ。「登録・更新」は Modal を同期応答、それ以外は deferred + waitUntil。 */
export const handleComponentInteraction = (
  interaction: APIMessageComponentInteraction,
  env: Env,
  ctx: WaitUntilContext,
): APIInteractionResponse => {
  const [, action, recruitId] = interaction.data.custom_id.split(":");

  // 「登録・更新」ボタンは Modal を同期的に返す（deferred 不可）
  if (action === "register") {
    return buildRegisterModalResponse(recruitId);
  }

  ctx.waitUntil(
    (async () => {
      try {
        switch (action) {
          case "cancel":
            await handleRecruitCancel(interaction, recruitId, env);
            break;
          default:
            // 旧時間選択操作は既知の操作ではなくなり、unknown として扱う（DB は変更しない）
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
 * の両方を返しうるため、どちらも辿れるようにする。
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

const handleRecruitRegistration = async (
  interaction: APIModalSubmitInteraction,
  recruitId: string,
  env: Env,
): Promise<void> => {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  const fields = extractModalFields(interaction.data.components as unknown);
  const partySizePreferenceRaw = fields["party_size_preference"];
  const availableTimeRaw = fields["available_time"] ?? "";

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

  const availableTime = availableTimeRaw.trim();
  if (!/^\d{2}:\d{2}$/.test(availableTime)) {
    await respond(env, interaction, {
      content: "エラー: 希望時間は HH:mm 形式で入力してください（例: 20:30）",
    });
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

  const schedule = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, recruit.scheduleId))
    .get();
  if (!schedule) {
    await respond(env, interaction, { content: "エラー: スケジュールが見つかりません" });
    return;
  }

  const settings = await db
    .select()
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, recruit.guildId))
    .get();
  const timezone = settings?.timezone ?? "Asia/Tokyo";

  // HH:mm 入力を募集時間内の一意候補に解決する
  const timeOptions = buildTimeOptions(
    recruit.targetDateLocal,
    schedule.postTimeHHmm,
    schedule.intervalMin,
    schedule.durationMin,
    timezone,
  );
  const matches = timeOptions.filter((opt) => opt.label === availableTime);
  if (matches.length === 0) {
    await respond(env, interaction, {
      content: "エラー: 希望時間は募集時間内の HH:mm で入力してください",
    });
    return;
  }
  if (matches.length >= 2) {
    await respond(env, interaction, {
      content:
        "エラー: 希望時間が複数候補に一致しました。募集期間を短くするか管理者に確認してください",
    });
    return;
  }

  const availableFromUtc = matches[0]!.value;
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

  const localTime = new Date(availableFromUtc).toLocaleString("ja-JP", { timeZone: timezone });
  await respond(env, interaction, {
    content: `希望時間を登録しました: ${localTime} / 希望パーティサイズ: ${partySizePreferenceLabel(partySizePreference)}`,
  });

  // ランク再取得はベストエフォート（失敗してもマッチングは継続）
  await updateAllUserRanks(userId, db, env.HENRIKDEV_API_KEY);
};

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
