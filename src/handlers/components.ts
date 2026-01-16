import { InteractionResponseType } from "discord-interactions";
import type { Context } from "hono";
import { and, eq, } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { guildSettings, recruitEntries, recruits, schedules } from "../db/schema";
import { deleteDiscordMessage, } from "../features/discord";
import type { Env, InteractionBody } from "../lib/types";

export async function handleComponentInteraction(
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

export async function handleJoinComponent(
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
  const { buildTimeOptions } = await import("../shared/time");
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

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

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

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

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

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

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

  await (async () => {
    const { recomputeMatch } = await import("./matching");
    await recomputeMatch(c, recruitId);
  })();

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
