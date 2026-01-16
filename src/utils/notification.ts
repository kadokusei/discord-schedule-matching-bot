export interface Match {
  memberIds: string[];
  meetTimeUtc: string;
}

export interface Diff {
  type: "created" | "updated" | "cancelled" | "unchanged";
  memberDiff: { removed: string[]; added: string[] } | null;
  timeDiff: { prev: string; next: string } | null;
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

function computeMemberDiff(prevIds: string[], nextIds: string[]): { removed: string[]; added: string[] } | null {
  const removed = prevIds.filter((id) => !nextIds.includes(id));
  const added = nextIds.filter((id) => !prevIds.includes(id));

  if (removed.length === 0 && added.length === 0) {
    return null;
  }

  return { removed, added };
}

function computeTimeDiff(prevTime: string, nextTime: string): { prev: string; next: string } | null {
  if (prevTime === nextTime) {
    return null;
  }

  const prevLabel = utcToHHmm(prevTime);
  const nextLabel = utcToHHmm(nextTime);

  return { prev: prevLabel, next: nextLabel };
}

function utcToHHmm(utc: string): string {
  const date = new Date(utc);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatNotification(diff: Diff, match: Match | null, tz: string): string {
  if (diff.type === "created" && match) {
    const members = match.memberIds.map((id) => `@${id}`).join(" ");
    const time = utcToHHmm(match.meetTimeUtc);
    return `【確定】${members} 集合 ${time}`;
  }

  if (diff.type === "cancelled") {
    return "【取消】確定条件（5人）未満になりました。";
  }

  if (diff.type === "updated") {
    const memberPart = diff.memberDiff
      ? `メンバー変更: (前) ${diff.memberDiff.removed.map((id) => `@${id}`).join(" ")} → (今) ${diff.memberDiff.added.map((id) => `@${id}`).join(" ")}`
      : "";
    let timePart = "";
    if (diff.timeDiff && diff.memberDiff) {
      timePart = `集合 ${diff.timeDiff.prev}→${diff.timeDiff.next}`;
    } else if (diff.timeDiff) {
      timePart = `集合時刻: ${diff.timeDiff.prev} → ${diff.timeDiff.next}`;
    }
    const both = memberPart && timePart ? " / " : "";
    const suffix = diff.memberDiff && !diff.timeDiff ? ` 集合 ${utcToHHmm(match?.meetTimeUtc ?? "")}` : "";
    const memberSuffix = diff.memberDiff ? `/ ` : "";
    const bothSuffix = diff.memberDiff && diff.timeDiff ? ` 集合 ${diff.timeDiff.prev}→${diff.timeDiff.next}` : "";

    const finalSuffix = diff.memberDiff && diff.timeDiff ? bothSuffix : (diff.memberDiff ? (suffix.startsWith(" ") ? memberSuffix + suffix.slice(1) : memberSuffix + suffix) : "/ 集合 " + suffix);

    return `【更新】${memberPart}${both}${timePart}${diff.timeDiff && !diff.memberDiff ? "（メンバーは同じ）" : ""}${finalSuffix}`;

  }

  if (diff.type === "unchanged") {
    return "";
  }

  return "";
}

export function matchSignature(match: Match | null): string {
  if (!match) {
    return "";
  }

  const sortedIds = [...match.memberIds].sort().join(",");
  return `${sortedIds}|${match.meetTimeUtc}`;
}
