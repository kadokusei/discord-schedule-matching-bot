import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { guildSettings, recruitEntries, recruits, riotAccounts, schedules } from "../db/schema";
import {
  type UpdateRecruitMessageParams,
  postChannelMessage,
  updateDiscordMessage,
} from "../features/discord";
import {
  type Entry,
  canUserJoinAnyParty,
  computeBestParty,
  findEarliestSubParty,
} from "../features/matching";
import {
  type Match,
  buildSmallPartyProposal,
  buildUndecidedNudge,
  currentIntervalSlotUtc,
  diffMatch,
  formatNotification,
  isRecruitActive,
  matchSignature,
  mentionTargets,
  shouldRemindUndecided,
} from "../features/recruit";
import { rankStringFromStored } from "../features/riot";
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

  // 終端状態(closed/cancelled/deleted)の募集は再計算で open/matched に戻さない（復活防止）
  if (!isRecruitActive(recruit.status)) {
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
  const reminderIntervalMin = settings?.reminderIntervalMin ?? 60;
  const nowUtc = new Date();

  // 参加状況を計算
  const confirmedCount = entries.filter((entry) => entry.state === "confirmed").length;
  const undecidedEntries = entries.filter((entry) => entry.state === "undecided");
  const undecidedCount = undecidedEntries.length;

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

  const undecidedUserIds = undecidedEntries.map((entry) => entry.userId);

  // 各ユーザーのランク情報を取得（nudge のランク適合判定とマッチ計算の両方で使う）
  const userIds = entries.map((e) => e.userId);
  const riotAccountList = await db
    .select()
    .from(riotAccounts)
    .where(inArray(riotAccounts.userId, userIds))
    .all();

  // computeBestParty 用: ユーザーごとの代表ランク(JSON文字列)
  const userRanks = new Map<string, string>();
  // 少人数ランク適合判定用: ユーザーごとの全アカウントのランク表示名
  const ranksByUser = new Map<string, string[]>();
  for (const account of riotAccountList) {
    userRanks.set(account.userId, account.rank);
    const rank = rankStringFromStored(account.rank);
    if (rank) {
      ranksByUser.set(account.userId, [...(ranksByUser.get(account.userId) ?? []), rank]);
    }
  }

  // 「未定」者への人数充足リマインド: 確定者＋未定者が少人数の下限(2)に達したら、
  // 未送信(lastRemindedAtUtc === null)の未定者へ 1 回だけ時間確定を促す。
  // ただし本人が自分のアクション（未定への変更など）でトリガした recompute では本人へ送らない。
  // また「実際にパーティへ入れる未定者」だけに送る:
  //   - 5人(フルマッチ)に届きうる(confirmed+undecided>=5)ならランク差/アカウント不問
  //   - そうでなければ少人数でランク差制限を満たして組める未定者のみ(canUserJoinAnyParty)
  if (confirmedCount + undecidedCount >= 2) {
    const fivePossible = confirmedCount + undecidedCount >= 5;
    const confirmedUserIds = confirmedUsers.map((u) => u.userId);
    for (const entry of undecidedEntries) {
      if (!shouldRemindUndecided(entry.lastRemindedAtUtc, nowUtc, reminderIntervalMin)) continue;
      if (entry.userId === triggeredBy) continue;
      if (!fivePossible) {
        const targetRanks = ranksByUser.get(entry.userId) ?? [];
        const otherRanks = confirmedUserIds.map((id) => ranksByUser.get(id) ?? []);
        if (!canUserJoinAnyParty(targetRanks, otherRanks)) continue;
      }
      try {
        await postChannelMessage(
          env,
          recruit.channelId,
          `<@${entry.userId}> ${buildUndecidedNudge()}`,
          { users: [entry.userId] },
        );
        await db
          .update(recruitEntries)
          .set({ lastRemindedAtUtc: new Date().toISOString() })
          .where(
            and(eq(recruitEntries.recruitId, recruitId), eq(recruitEntries.userId, entry.userId)),
          );
      } catch (error) {
        console.error(
          `[UNDECIDED_NUDGE] Failed to notify user ${entry.userId} in recruit ${recruitId}:`,
          error,
        );
      }
    }
  }

  const previousMatch = buildMatchFromRecruit(recruit);

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
    // open 場面で編成候補を表示: cron の少人数提案(proposeSmallParties)と同一の関数チェーンで、
    // 「今のスロットまでに集合可能」な最良2〜3人編成を算出する。
    const slotUtc = schedule
      ? currentIntervalSlotUtc(
          { targetDateLocal: recruit.targetDateLocal },
          {
            postTimeHHmm: schedule.postTimeHHmm,
            intervalMin: schedule.intervalMin,
            durationMin: schedule.durationMin,
          },
          timezone,
          nowUtc,
        )
      : null;

    const formationCandidate = slotUtc
      ? (() => {
          const proposal = buildSmallPartyProposal(
            confirmedEntries.map((e) => ({
              userId: e.userId,
              availableFromUtc: e.availableFromUtc,
              createdAtUtc: e.createdAtUtc,
            })),
            ranksByUser,
            slotUtc,
          );
          return proposal
            ? { memberIds: proposal.party.memberIds, meetTimeUtc: proposal.party.meetTimeUtc }
            : undefined;
        })()
      : undefined;

    // Discord更新を先に試みる
    const discordResult = await attemptDiscordUpdate(env, recruit.channelId, recruit.messageId, {
      targetDateLocal: recruit.targetDateLocal,
      postTimeHHmm,
      status: "open",
      confirmedCount,
      undecidedCount,
      confirmedUsers,
      undecidedUserIds,
      formationCandidate,
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

  // 全員集合(最遅時刻)より早く始められる、ランク条件を満たす2〜3人のサブ組を探して併記する
  const partyMemberSet = new Set(bestParty.memberIds);
  const earlierSubParty = findEarliestSubParty(
    confirmedEntries
      .filter((e) => partyMemberSet.has(e.userId))
      .map((e) => ({
        userId: e.userId,
        availableFromUtc: e.availableFromUtc,
        createdAtUtc: e.createdAtUtc,
        accountRanks: ranksByUser.get(e.userId) ?? [],
      })),
    bestParty.meetTimeUtc,
  );

  // Discord更新を先に試みる
  const discordResult = await attemptDiscordUpdate(env, recruit.channelId, recruit.messageId, {
    targetDateLocal: recruit.targetDateLocal,
    postTimeHHmm,
    status: "matched",
    confirmedCount,
    undecidedCount,
    confirmedUsers,
    undecidedUserIds,
    matchedMembers: bestParty.memberIds,
    matchedTime: new Date(bestParty.meetTimeUtc).toLocaleTimeString("ja-JP", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }),
    earlierSubParty: earlierSubParty
      ? { memberIds: earlierSubParty.memberIds, meetTimeUtc: earlierSubParty.meetTimeUtc }
      : undefined,
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
    needsMentionLine && targets.length > 0 ? `${targets.map((id) => `<@${id}>`).join(" ")}\n` : "";
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
