import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  guildSettings,
  recruitEntries,
  recruits,
  schedules,
} from "../db/schema";
import {
  filterPendingReminders,
  buildReminderMessage,
  shouldCreateInstance,
} from "../features/recruit";
import { postChannelMessage, postRecruitMessage } from "../features/discord";
import type { Env } from "../lib/types";

export async function handleScheduled(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const nowUtc = new Date();

  const settingsRows = await db.select().from(guildSettings).all();
  const settingsByGuild = new Map(
    settingsRows.map((row) => [row.guildId, row]),
  );

  const allSchedules = await db.select().from(schedules).all();

  for (const schedule of allSchedules) {
    if (!schedule.active) {
      continue;
    }

    const settings = settingsByGuild.get(schedule.guildId);
    const tz = settings?.timezone ?? "Asia/Tokyo";

    const existingRecruits = await db
      .select({ targetDateLocal: recruits.targetDateLocal })
      .from(recruits)
      .where(eq(recruits.scheduleId, schedule.id))
      .all();

    const shouldCreate = shouldCreateInstance(
      nowUtc,
      { postTimeHHmm: schedule.postTimeHHmm },
      tz,
      existingRecruits,
    );

    if (!shouldCreate) {
      continue;
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(nowUtc);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const targetDateLocal = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const recruitId = crypto.randomUUID();
    const messageId = await postRecruitMessage(env, schedule.channelId, {
      recruitId,
      targetDateLocal,
      postTimeHHmm: schedule.postTimeHHmm,
      template: schedule.template,
    });

    await db.insert(recruits).values({
      id: recruitId,
      scheduleId: schedule.id,
      guildId: schedule.guildId,
      channelId: schedule.channelId,
      messageId,
      targetDateLocal,
      status: "open",
    });
  }

  // リマインド処理
  const pendingEntries = await db
    .select()
    .from(recruitEntries)
    .where(eq(recruitEntries.state, "pending_time"))
    .all();

  if (pendingEntries.length > 0) {
    // recruit 情報を取得
    const recruitIds = pendingEntries.map((e) => e.recruitId);
    const recruitsData = await db
      .select()
      .from(recruits)
      .where(inArray(recruits.id, recruitIds))
      .all();

    const recruitsByRecruitId = new Map(recruitsData.map((r) => [r.id, r]));

    // 各ギルドの設定を取得
    const guildIds = recruitsData.map((r) => r.guildId);
    const guildSettingsData = await db
      .select()
      .from(guildSettings)
      .where(inArray(guildSettings.guildId, guildIds))
      .all();

    const settingsByGuildId = new Map(
      guildSettingsData.map((s) => [s.guildId, s]),
    );

    // リマインド対象をフィルタリング
    const reminderTargets = filterPendingReminders(
      pendingEntries.map((entry) => ({
        userId: entry.userId,
        recruitId: entry.recruitId,
        channelId: recruitsByRecruitId.get(entry.recruitId)?.channelId ?? "",
        lastRemindedAtUtc: entry.lastRemindedAtUtc,
      })),
      settingsByGuildId.get(recruitsData[0]?.guildId ?? "")
        ?.reminderIntervalMin,
      nowUtc,
    );

    // リマインドを送信
    for (const target of reminderTargets) {
      const recruit = recruitsByRecruitId.get(target.recruitId);
      if (!recruit) continue;

      const reminderMessage = buildReminderMessage(target.recruitId);

      try {
        // チャンネルメンションで通知
        await postChannelMessage(
          env,
          target.channelId,
          `<@${target.userId}> ${reminderMessage}`,
        );

        // メッセージ送信成功後のみリマインド時刻を更新
        await db
          .update(recruitEntries)
          .set({
            lastRemindedAtUtc: nowUtc.toISOString(),
          })
          .where(
            and(
              eq(recruitEntries.recruitId, target.recruitId),
              eq(recruitEntries.userId, target.userId),
            ),
          );
      } catch (error) {
        // リマインド送信失敗時はログに出力して、次のターゲットに進む
        console.error(
          `Failed to send reminder to user ${target.userId} in recruit ${target.recruitId}:`,
          error,
        );
      }
    }
  }
}
