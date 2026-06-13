import type { ComponentContext } from "discord-hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { deleteDiscordMessage } from "../features/discord";
import { fetchValorantRankWithCache } from "../features/riot";
import type { Env } from "../lib/types";

const hasValues = (data: unknown): data is { values: string[] } => {
  return (
    typeof data === "object" &&
    data !== null &&
    "values" in data &&
    Array.isArray((data as { values: unknown }).values)
  );
};

type RankUpdateResult =
  | { success: true; accountCount: number; failedCount: number }
  | { success: false; error: string };

const updateAllUserRanks = async (
  userId: string,
  db: DrizzleD1Database<typeof schema>,
  apiKey: string,
): Promise<RankUpdateResult> => {
  const userAccounts = await db
    .select()
    .from(schema.riotAccounts)
    .where(eq(schema.riotAccounts.userId, userId))
    .all();

  if (userAccounts.length === 0) {
    return { success: true, accountCount: 0, failedCount: 0 };
  }

  const results = await Promise.allSettled(
    userAccounts.map((account) =>
      fetchValorantRankWithCache(
        account.gameName,
        account.tagLine,
        userId,
        db,
        apiKey,
        { isJoining: true },
      ),
    ),
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = results.length - succeeded;

  return {
    success: true,
    accountCount: userAccounts.length,
    failedCount: failed,
  };
};

export const handlerRecruitJoin = async (
  c: ComponentContext<{ Bindings: Env }>,
) => {
  const customId = c.interaction.data.custom_id;
  const [, , recruitId] = customId.split(":");
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";

  if (!recruitId || !userId) {
    return c.res("エラー: 必要な情報が不足しています");
  }

  const db = drizzle(c.env.DB, { schema });
  const nowUtc = new Date().toISOString();

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  if (!recruit) {
    return c.res("エラー: 募集が見つかりません");
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

  const intervalMin =
    schedule?.intervalMin ?? settings?.defaultIntervalMin ?? 30;
  const durationMin =
    schedule?.durationMin ?? settings?.defaultDurationMin ?? 360;
  const timezone = settings?.timezone ?? "Asia/Tokyo";

  const { buildTimeOptions } = await import("../shared/time");
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

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

  (async () => {
    const result = await updateAllUserRanks(
      userId,
      db,
      c.env.HENRIKDEV_API_KEY,
    );

    if (result.success && result.failedCount > 0) {
      console.warn(
        `[RANK_UPDATE] ${result.failedCount}/${result.accountCount} accounts failed to update for user ${userId}`,
      );
    }
  })();

  return c.update().res({
    content: "参加登録しました。希望時間を選んでください。",
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
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
  });
};

export const handlerRecruitTime = async (
  c: ComponentContext<{ Bindings: Env }>,
) => {
  const customId = c.interaction.data.custom_id;
  const [, , recruitId] = customId.split(":");
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";
  const selectedTime = hasValues(c.interaction.data)
    ? c.interaction.data.values[0]
    : undefined;

  if (!recruitId || !userId || !selectedTime) {
    return c.res("エラー: 必要な情報が不足しています");
  }

  const db = drizzle(c.env.DB, { schema });
  const nowUtc = new Date().toISOString();

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  const settings = await db
    .select()
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, recruit?.guildId ?? ""))
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

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

  return c.update().res({
    content: `希望時間を登録しました: ${new Date(selectedTime).toLocaleString("ja-JP", { timeZone: timezone })}`,
    components: [],
  });
};

export const handlerRecruitCancel = async (
  c: ComponentContext<{ Bindings: Env }>,
) => {
  const customId = c.interaction.data.custom_id;
  const [, , recruitId] = customId.split(":");
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";

  if (!recruitId || !userId) {
    return c.res("エラー: 必要な情報が不足しています");
  }

  const db = drizzle(c.env.DB, { schema });

  await db
    .delete(schema.recruitEntries)
    .where(
      and(
        eq(schema.recruitEntries.recruitId, recruitId),
        eq(schema.recruitEntries.userId, userId),
      ),
    );

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

  return c.res("参加を取り消しました。");
};

export const handlerRecruitDelete = async (
  c: ComponentContext<{ Bindings: Env }>,
) => {
  const customId = c.interaction.data.custom_id;
  const [, , recruitId] = customId.split(":");
  const userId = c.interaction.member?.user?.id ?? c.interaction.user?.id ?? "";

  if (!recruitId || !userId) {
    return c.res("エラー: 必要な情報が不足しています");
  }

  const db = drizzle(c.env.DB, { schema });
  const nowUtc = new Date().toISOString();

  const recruit = await db
    .select()
    .from(schema.recruits)
    .where(eq(schema.recruits.id, recruitId))
    .get();

  if (!recruit) {
    return c.res("エラー: 募集が見つかりません");
  }

  // スケジュール作成者のみ削除可能
  const schedule = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, recruit.scheduleId))
    .get();

  if (schedule && schedule.creatorId !== userId) {
    return c.res("エラー: 募集の削除はスケジュール作成者のみ可能です");
  }

  if (recruit.messageId) {
    await deleteDiscordMessage(c.env, recruit.channelId, recruit.messageId);
  }

  await db
    .update(schema.recruits)
    .set({
      deletedBy: userId,
      deletedAtUtc: nowUtc,
      status: "deleted",
    })
    .where(eq(schema.recruits.id, recruitId));

  await db
    .delete(schema.recruitEntries)
    .where(eq(schema.recruitEntries.recruitId, recruitId));

  return c.res("募集を削除しました。");
};
