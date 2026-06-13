import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { guildSettings, recruitEntries, recruits, riotAccounts, schedules } from "../db/schema";
import {
  type UpdateRecruitMessageParams,
  postChannelMessage,
  updateDiscordMessage,
} from "../features/discord";
import { type Entry, computeBestParty } from "../features/matching";
import {
  type Match,
  diffMatch,
  formatNotification,
  matchSignature,
  mentionTargets,
} from "../features/recruit";
import type { Env } from "../lib/types";

type DiscordUpdateResult = { success: true } | { success: false; error: Error };

const attemptDiscordUpdate = async (
  env: Env,
  channelId: string,
  messageId: string | null,
  params: UpdateRecruitMessageParams,
): Promise<DiscordUpdateResult> => {
  if (!messageId) {
    return {
      success: false,
      error: new Error("messageId is null or undefined"),
    };
  }

  try {
    await updateDiscordMessage(env, channelId, messageId, params);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

export async function recomputeMatch(
  env: Env,
  recruitId: string,
  triggeredBy?: string,
): Promise<void> {
  const db = drizzle(env.DB);

  const entries = await db
    .select()
    .from(recruitEntries)
    .where(eq(recruitEntries.recruitId, recruitId))
    .all();

  const recruit = await db.select().from(recruits).where(eq(recruits.id, recruitId)).get();

  if (!recruit) {
    return;
  }

  // schedule を取得して postTimeHHmm を取得
  const schedule = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, recruit.scheduleId))
    .get();

  const postTimeHHmm = schedule?.postTimeHHmm ?? "20:00";

  // guildSettings を取得してタイムゾーンを取得
  const settings = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, recruit.guildId))
    .get();

  const timezone = settings?.timezone ?? "Asia/Tokyo";

  // 参加状況を計算
  const confirmedCount = entries.filter((entry) => entry.state === "confirmed").length;
  const pendingCount = entries.filter((entry) => entry.state === "pending_time").length;

  const confirmedUsers = entries
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        availableFromUtc: NonNullable<typeof entry.availableFromUtc>;
      } => entry.state === "confirmed" && entry.availableFromUtc !== null,
    )
    .map((entry) => ({
      userId: entry.userId,
      availableFromUtc: entry.availableFromUtc,
    }));

  const pendingUserIds = entries
    .filter((entry) => entry.state === "pending_time")
    .map((entry) => entry.userId);

  const previousMatch = buildMatchFromRecruit(recruit);

  // 各ユーザーのランク情報を取得
  const userIds = entries.map((e) => e.userId);
  const riotAccountList = await db
    .select()
    .from(riotAccounts)
    .where(inArray(riotAccounts.userId, userIds))
    .all();

  const userRanks = new Map<string, string>();
  for (const account of riotAccountList) {
    userRanks.set(account.userId, account.rank);
  }

  const confirmedEntries = entries
    .filter((entry) => entry.state === "confirmed" && entry.availableFromUtc)
    .map(
      (entry): Entry => ({
        userId: entry.userId,
        availableFromUtc: entry.availableFromUtc ?? "",
        rank: userRanks.get(entry.userId),
        createdAtUtc: entry.createdAtUtc,
      }),
    );

  if (confirmedEntries.length < 5) {
    // Discord更新を先に試みる
    const discordResult = await attemptDiscordUpdate(env, recruit.channelId, recruit.messageId, {
      targetDateLocal: recruit.targetDateLocal,
      postTimeHHmm,
      status: "open",
      confirmedCount,
      pendingCount,
      confirmedUsers,
      pendingUserIds,
      timezone,
    });

    if (!discordResult.success) {
      console.error(
        `[MATCHING] Failed to update Discord message for recruit ${recruitId}:`,
        discordResult.error.message,
      );
      // Discord更新失敗時はDB更新をスキップしてreturn
      return;
    }

    // Discord成功後にDB更新
    await db
      .update(recruits)
      .set({
        status: "open",
        matchSignature: null,
        matchedMeetTimeUtc: null,
        matchedMemberIdsJson: null,
      })
      .where(eq(recruits.id, recruitId));

    await notifyMatchUpdate(env, recruit, previousMatch, null, timezone, triggeredBy);
    return;
  }

  const bestParty = computeBestParty(confirmedEntries);
  const signature = matchSignature(bestParty);

  // Discord更新を先に試みる
  const discordResult = await attemptDiscordUpdate(env, recruit.channelId, recruit.messageId, {
    targetDateLocal: recruit.targetDateLocal,
    postTimeHHmm,
    status: "matched",
    confirmedCount,
    pendingCount,
    confirmedUsers,
    pendingUserIds,
    matchedMembers: bestParty.memberIds,
    matchedTime: new Date(bestParty.meetTimeUtc).toLocaleTimeString("ja-JP", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }),
    timezone,
  });

  if (!discordResult.success) {
    console.error(
      `[MATCHING] Failed to update Discord message for recruit ${recruitId}:`,
      discordResult.error.message,
    );
    // Discord更新失敗時はDB更新をスキップしてreturn
    return;
  }

  // Discord成功後にDB更新
  await db
    .update(recruits)
    .set({
      status: "matched",
      matchSignature: signature,
      matchedMeetTimeUtc: bestParty.meetTimeUtc,
      matchedMemberIdsJson: JSON.stringify(bestParty.memberIds),
    })
    .where(eq(recruits.id, recruitId));

  await notifyMatchUpdate(
    env,
    recruit,
    previousMatch,
    {
      memberIds: bestParty.memberIds,
      meetTimeUtc: bestParty.meetTimeUtc,
    },
    timezone,
    triggeredBy,
  );
}

type RecruitMatchSource = {
  matchedMeetTimeUtc?: string | null;
  matchedMemberIdsJson?: string | null;
  [key: string]: unknown;
};

export function buildMatchFromRecruit(recruit: RecruitMatchSource): Match | null {
  if (!recruit.matchedMeetTimeUtc || !recruit.matchedMemberIdsJson) {
    return null;
  }

  try {
    const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
    if (!Array.isArray(memberIds)) {
      return null;
    }
    return {
      memberIds,
      meetTimeUtc: recruit.matchedMeetTimeUtc,
    };
  } catch {
    return null;
  }
}

async function notifyMatchUpdate(
  env: Env,
  recruit: typeof recruits.$inferSelect,
  prev: Match | null,
  next: Match | null,
  timezone: string,
  triggeredBy?: string,
): Promise<void> {
  const diff = diffMatch(prev, next);

  if (diff.type === "unchanged") {
    return;
  }

  const message = formatNotification(diff, next, timezone);

  if (!message) {
    return;
  }

  const nextSignature = matchSignature(next);
  const lastSignature = recruit.lastNotifiedSignature ?? "";

  if (diff.type === "cancelled" && !lastSignature) {
    return;
  }

  if (diff.type !== "cancelled" && nextSignature === lastSignature) {
    return;
  }

  // ping 対象（取消は本人を除外、確定/更新は対象メンバー全員）
  const targets = mentionTargets(diff, prev, next, triggeredBy);

  // 取消/更新の本文には全対象の <@id> が含まれないため、先頭に ping 行を付与する。
  // 確定の本文は既に全メンバーの <@id> を含むため付与不要。
  const needsMentionLine = diff.type === "cancelled" || diff.type === "updated";
  const mentionLine =
    needsMentionLine && targets.length > 0
      ? `${targets.map((id) => `<@${id}>`).join(" ")}\n`
      : "";
  const content = `${mentionLine}${message}`;

  await postChannelMessage(
    env,
    recruit.channelId,
    content,
    targets.length > 0 ? { users: targets } : { parse: [] },
  );

  const db = drizzle(env.DB);

  await db
    .update(recruits)
    .set({
      lastNotifiedSignature: nextSignature || null,
    })
    .where(eq(recruits.id, recruit.id));
}
