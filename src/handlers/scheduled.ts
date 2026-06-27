import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { guildSettings, recruitEntries, recruits, riotAccounts, schedules } from "../db/schema";
import { postChannelMessage, postRecruitMessage, updateDiscordMessage } from "../features/discord";
import { findEarliestSubParty } from "../features/matching";
import {
  type PartySizePreference,
  buildSmallPartyProposal,
  currentIntervalSlotUtc,
  formatRegisterNudge,
  formatSmallPartyProposal,
  isRecruitExpired,
  matchSignature,
  shouldCreateInstance,
} from "../features/recruit";
import { rankStringFromStored } from "../features/riot";
import type { Env } from "../lib/types";

type DrizzleDb = ReturnType<typeof drizzle>;
type ScheduleRow = typeof schedules.$inferSelect;
type GuildSettingRow = typeof guildSettings.$inferSelect;

/**
 * 各 open 募集について、interval スロット境界が到来していれば、その時刻までに参加可能な
 * 確定者から成立する 2〜3 人パーティを探し、候補メンバーへ「通知のみ」で案内する（同意ボタンは無い）。
 * 人数が増えると構成が変わり再通知する。同一構成の重複通知は「最後に通知した構成のシグネチャ」で抑制する。
 * 全員集合より早く始められるサブ組があれば、その早期開始も併記する。
 */
async function proposeSmallParties(
  env: Env,
  db: DrizzleDb,
  allSchedules: ScheduleRow[],
  settingsByGuild: Map<string, GuildSettingRow>,
  nowUtc: Date,
): Promise<void> {
  const openRecruits = await db.select().from(recruits).where(eq(recruits.status, "open")).all();

  for (const recruit of openRecruits) {
    const schedule = allSchedules.find((s) => s.id === recruit.scheduleId);
    if (!schedule) continue;

    const tz = settingsByGuild.get(recruit.guildId)?.timezone ?? "Asia/Tokyo";

    const slotUtc = currentIntervalSlotUtc(
      { targetDateLocal: recruit.targetDateLocal },
      {
        postTimeHHmm: schedule.postTimeHHmm,
        intervalMin: schedule.intervalMin,
        durationMin: schedule.durationMin,
      },
      tz,
      nowUtc,
    );

    if (!slotUtc) continue;

    const entries = await db
      .select()
      .from(recruitEntries)
      .where(eq(recruitEntries.recruitId, recruit.id))
      .all();

    const confirmed = entries.map((e) => ({
      userId: e.userId,
      availableFromUtc: e.availableFromUtc,
      createdAtUtc: e.createdAtUtc,
      partySizePreference: e.partySizePreference as PartySizePreference,
    }));

    if (confirmed.length < 2) continue;

    // 候補ユーザーの全アカウントのランクを収集
    const userIds = confirmed.map((e) => e.userId);
    const accounts = await db
      .select()
      .from(riotAccounts)
      .where(inArray(riotAccounts.userId, userIds))
      .all();

    const ranksByUser = new Map<string, string[]>();
    for (const account of accounts) {
      const rank = rankStringFromStored(account.rank);
      if (!rank) continue;
      ranksByUser.set(account.userId, [...(ranksByUser.get(account.userId) ?? []), rank]);
    }

    const proposal = buildSmallPartyProposal(confirmed, ranksByUser, slotUtc);
    if (!proposal) continue;

    const { party, unrankedUserIds } = proposal;

    // 同一構成の重複通知を抑制（最後に通知した構成のシグネチャと比較）
    const signature = matchSignature({
      memberIds: party.memberIds,
      meetTimeUtc: party.meetTimeUtc,
    });
    const lastSignature = recruit.smallPartyMemberIdsJson
      ? matchSignature({
          memberIds: JSON.parse(recruit.smallPartyMemberIdsJson) as string[],
          meetTimeUtc: recruit.smallPartyMeetTimeUtc ?? "",
        })
      : null;
    if (signature === lastSignature) continue;

    // 3人提案なら、全員集合より早く始められる2〜3人のサブ組を探して併記する
    const partyCandidates = confirmed
      .filter((e) => party.memberIds.includes(e.userId))
      .map((e) => ({ ...e, accountRanks: ranksByUser.get(e.userId) ?? [] }));
    const earlier =
      party.size === 3 ? findEarliestSubParty(partyCandidates, party.meetTimeUtc) : null;

    try {
      await postChannelMessage(
        env,
        recruit.channelId,
        formatSmallPartyProposal(
          party.memberIds,
          party.meetTimeUtc,
          party.size,
          tz,
          earlier ? { memberIds: earlier.memberIds, meetTimeUtc: earlier.meetTimeUtc } : undefined,
        ),
        { users: party.memberIds },
      );
    } catch (error) {
      console.error(`[SMALL_PARTY] Failed to post notification for recruit ${recruit.id}:`, error);
      continue;
    }

    // 通知済み構成を保存（次回以降の重複抑制に使う）
    await db
      .update(recruits)
      .set({
        smallPartyMemberIdsJson: JSON.stringify(party.memberIds),
        smallPartyMeetTimeUtc: party.meetTimeUtc,
      })
      .where(eq(recruits.id, recruit.id));

    // ランク未登録の参加可能者には登録を促す
    if (unrankedUserIds.length > 0) {
      try {
        await postChannelMessage(env, recruit.channelId, formatRegisterNudge(unrankedUserIds), {
          users: unrankedUserIds,
        });
      } catch (error) {
        console.error(
          `[SMALL_PARTY] Failed to post register nudge for recruit ${recruit.id}:`,
          error,
        );
      }
    }
  }
}

export async function handleScheduled(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const nowUtc = new Date();

  const settingsRows = await db.select().from(guildSettings).all();
  const settingsByGuild = new Map(settingsRows.map((row) => [row.guildId, row]));

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

    // 予約先行（reserve-then-post）: 先に DB 行を確保してから Discord 投稿する。
    // (schedule_id, target_date_local) の一意制約により、cron の重複起動やリトライで
    // 2 つの起動が同時に「未作成」と判断しても、行を確保できるのは 1 つだけになる。
    // 確保に失敗（=既に他起動が作成済み）したら何もしない（冪等）。
    const reserved = await db
      .insert(recruits)
      .values({
        id: recruitId,
        scheduleId: schedule.id,
        guildId: schedule.guildId,
        channelId: schedule.channelId,
        messageId: "", // 投稿成功後に更新するプレースホルダ
        targetDateLocal,
        status: "open",
      })
      .onConflictDoNothing({ target: [recruits.scheduleId, recruits.targetDateLocal] })
      .returning({ id: recruits.id });

    if (reserved.length === 0) {
      // 既に同一スケジュール・同一日の募集が存在する → 二重投稿しない
      continue;
    }

    // 予約できた起動だけが Discord に投稿する。投稿失敗時は予約行を削除して孤児行を残さない。
    try {
      const messageId = await postRecruitMessage(env, schedule.channelId, {
        recruitId,
        targetDateLocal,
        postTimeHHmm: schedule.postTimeHHmm,
        template: schedule.template,
        intervalMin: schedule.intervalMin,
        durationMin: schedule.durationMin,
        timezone: tz,
      });

      await db.update(recruits).set({ messageId }).where(eq(recruits.id, recruitId));
    } catch (error) {
      console.error(
        `[SCHEDULE_CREATE] Failed to post recruit message for schedule ${schedule.id} (${targetDateLocal}); rolling back reservation:`,
        error,
      );
      await db.delete(recruits).where(eq(recruits.id, recruitId));
    }
  }

  // 期限切れ募集のクローズ処理
  const openRecruits = await db.select().from(recruits).where(eq(recruits.status, "open")).all();

  for (const recruit of openRecruits) {
    const schedule = allSchedules.find((s) => s.id === recruit.scheduleId);
    if (!schedule) continue;

    const settings = settingsByGuild.get(recruit.guildId);
    const tz = settings?.timezone ?? "Asia/Tokyo";

    const expired = isRecruitExpired(
      {
        targetDateLocal: recruit.targetDateLocal,
        postTimeHHmm: schedule.postTimeHHmm,
        durationMin: schedule.durationMin,
      },
      tz,
      nowUtc,
    );

    if (!expired) continue;

    await db.update(recruits).set({ status: "closed" }).where(eq(recruits.id, recruit.id));

    // Embed を更新してクローズ状態を反映
    try {
      const entries = await db
        .select()
        .from(recruitEntries)
        .where(eq(recruitEntries.recruitId, recruit.id))
        .all();

      await updateDiscordMessage(env, recruit.channelId, recruit.messageId, {
        targetDateLocal: recruit.targetDateLocal,
        postTimeHHmm: schedule.postTimeHHmm,
        status: "cancelled",
        confirmedCount: entries.length,
        timezone: tz,
      });
    } catch (error) {
      console.error(`[EXPIRY] Failed to update Discord message for recruit ${recruit.id}:`, error);
    }
  }

  // 少人数(2〜3人)パーティ提案パス（interval スロット境界契機）
  await proposeSmallParties(env, db, allSchedules, settingsByGuild, nowUtc);
}
