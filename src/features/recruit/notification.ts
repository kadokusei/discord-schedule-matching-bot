export interface Match {
  memberIds: string[];
  meetTimeUtc: string;
}

export interface Diff {
  type: "created" | "updated" | "cancelled" | "unchanged";
  memberDiff: { removed: string[]; added: string[] } | null;
  /** 変更前後の集合時刻（UTC ISO8601）。表示時にギルド tz へ変換する。 */
  timeDiff: { prevUtc: string; nextUtc: string } | null;
}

export function diffMatch(prev: Match | null, next: Match | null): Diff {
  if (!prev && next) {
    return { type: "created", memberDiff: null, timeDiff: null };
  }

  if (prev && !next) {
    return { type: "cancelled", memberDiff: null, timeDiff: null };
  }

  if (prev && next) {
    const signaturePrev = matchSignature(prev);
    const signatureNext = matchSignature(next);

    if (signaturePrev === signatureNext) {
      return { type: "unchanged", memberDiff: null, timeDiff: null };
    }

    const memberDiff = computeMemberDiff(prev.memberIds, next.memberIds);
    const timeDiff = computeTimeDiff(prev.meetTimeUtc, next.meetTimeUtc);

    return { type: "updated", memberDiff, timeDiff };
  }

  return { type: "unchanged", memberDiff: null, timeDiff: null };
}

function computeMemberDiff(
  prevIds: string[],
  nextIds: string[],
): { removed: string[]; added: string[] } | null {
  const removed = prevIds.filter((id) => !nextIds.includes(id));
  const added = nextIds.filter((id) => !prevIds.includes(id));

  if (removed.length === 0 && added.length === 0) {
    return null;
  }

  return { removed, added };
}

function computeTimeDiff(
  prevTime: string,
  nextTime: string,
): { prevUtc: string; nextUtc: string } | null {
  if (prevTime === nextTime) {
    return null;
  }

  return { prevUtc: prevTime, nextUtc: nextTime };
}

/** UTC ISO8601 を指定タイムゾーンの "HH:mm"（24時間表記）に変換する。 */
export function utcToLocalHHmm(utc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(utc));
}

const mention = (id: string): string => `<@${id}>`;

export function formatNotification(diff: Diff, match: Match | null, tz: string): string {
  const fmt = (utc: string): string => utcToLocalHHmm(utc, tz);

  if (diff.type === "created" && match) {
    const members = match.memberIds.map(mention).join(" ");
    return `【確定】\n🕘 集合時刻: ${fmt(match.meetTimeUtc)}\n👥 メンバー: ${members}`;
  }

  if (diff.type === "cancelled") {
    return "【取消】\n確定条件を満たさなくなりました。";
  }

  if (diff.type === "updated") {
    const parts: string[] = [];

    if (diff.memberDiff) {
      const removed = diff.memberDiff.removed.map(mention).join(" ");
      const added = diff.memberDiff.added.map(mention).join(" ");
      parts.push(`👥 メンバー変更: (前) ${removed} → (今) ${added}`);
    }

    if (diff.timeDiff) {
      parts.push(`🕘 集合時刻: ${fmt(diff.timeDiff.prevUtc)} → ${fmt(diff.timeDiff.nextUtc)}`);
    } else if (match) {
      parts.push(`🕘 集合時刻: ${fmt(match.meetTimeUtc)}`);
    }

    return `【更新】\n${parts.join("\n")}`;
  }

  return "";
}

/**
 * 通知で ping すべきメンバー ID の一覧を算出する。
 * - created / updated: 現在のマッチメンバー全員（トリガー除外なし）
 * - cancelled: 解消前メンバーから、それをトリガーした本人を除外
 */
export function mentionTargets(
  diff: Diff,
  prev: Match | null,
  next: Match | null,
  triggeredBy?: string,
): string[] {
  if (diff.type === "cancelled") {
    return (prev?.memberIds ?? []).filter((id) => id !== triggeredBy);
  }

  if (diff.type === "created" || diff.type === "updated") {
    return next?.memberIds ?? [];
  }

  return [];
}

export function matchSignature(match: Match | null): string {
  if (!match) {
    return "";
  }

  const sortedIds = [...match.memberIds].sort().join(",");
  return `${sortedIds}|${match.meetTimeUtc}`;
}
