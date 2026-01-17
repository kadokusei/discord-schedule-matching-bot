import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import {
  guildSettings,
  recruitEntries,
  recruits,
  riotAccounts,
  schedules,
} from "../db/schema";
import { computeBestParty, type Entry } from "../features/matching";
import {
  diffMatch,
  formatNotification,
  matchSignature,
  type Match,
} from "../features/recruit";
import { postChannelMessage, updateDiscordMessage } from "../features/discord";
import type { Env } from "../lib/types";

export async function recomputeMatch(
  c: Context<{ Bindings: Env }>,
  recruitId: string,
): Promise<void> {
  const db = drizzle(c.env.DB);

  const entries = await db
    .select()
    .from(recruitEntries)
    .where(eq(recruitEntries.recruitId, recruitId))
    .all();

  const recruit = await db
    .select()
    .from(recruits)
    .where(eq(recruits.id, recruitId))
    .get();

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
  const confirmedCount = entries.filter(
    (entry) => entry.state === "confirmed",
  ).length;
  const pendingCount = entries.filter(
    (entry) => entry.state === "pending_time",
  ).length;

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
    await db
      .update(recruits)
      .set({
        status: "open",
        matchSignature: null,
        matchedMeetTimeUtc: null,
        matchedMemberIdsJson: null,
      })
      .where(eq(recruits.id, recruitId));

    // Embed を更新
    try {
      await updateDiscordMessage(c.env, recruit.channelId, recruit.messageId, {
        targetDateLocal: recruit.targetDateLocal,
        postTimeHHmm,
        status: "open",
        confirmedCount,
        pendingCount,
        confirmedUsers,
        pendingUserIds,
        timezone,
      });
    } catch (error) {
      console.error(
        `Failed to update Discord message for recruit ${recruitId}:`,
        error,
      );
    }

    await notifyMatchUpdate(c.env, recruit, previousMatch, null);
    return;
  }

  const bestParty = computeBestParty(confirmedEntries);
  const signature = matchSignature(bestParty);

  await db
    .update(recruits)
    .set({
      status: "matched",
      matchSignature: signature,
      matchedMeetTimeUtc: bestParty.meetTimeUtc,
      matchedMemberIdsJson: JSON.stringify(bestParty.memberIds),
    })
    .where(eq(recruits.id, recruitId));

  // Embed を更新
  try {
    await updateDiscordMessage(c.env, recruit.channelId, recruit.messageId, {
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
  } catch (error) {
    console.error(
      `Failed to update Discord message for recruit ${recruitId}:`,
      error,
    );
  }

  await notifyMatchUpdate(c.env, recruit, previousMatch, {
    memberIds: bestParty.memberIds,
    meetTimeUtc: bestParty.meetTimeUtc,
  });
}

type RecruitMatchSource = {
  matchedMeetTimeUtc?: string | null;
  matchedMemberIdsJson?: string | null;
  [key: string]: unknown;
};

export function buildMatchFromRecruit(
  recruit: RecruitMatchSource,
): Match | null {
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
): Promise<void> {
  const diff = diffMatch(prev, next);

  if (diff.type === "unchanged") {
    return;
  }

  const message = formatNotification(diff, next, "UTC");

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

  await postChannelMessage(env, recruit.channelId, message);

  const db = drizzle(env.DB);

  await db
    .update(recruits)
    .set({
      lastNotifiedSignature: nextSignature || null,
    })
    .where(eq(recruits.id, recruit.id));
}
