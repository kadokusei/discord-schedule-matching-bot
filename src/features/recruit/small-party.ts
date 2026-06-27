import {
  type SmallParty,
  type SmallPartyCandidate,
  findBestSmallParty,
  majorTierOf,
} from "../matching";
import { type PartySizePreference, allowsSmallParty } from "./party-size";
import { utcToLocalHHmm } from "./notification";

export interface ConfirmedEntryInput {
  userId: string;
  availableFromUtc: string;
  createdAtUtc: string;
  partySizePreference: PartySizePreference;
}

export interface SmallPartyProposal {
  party: SmallParty;
  /** スロットまでに参加可能だが、ランク未取得で対象外になった確定ユーザー（登録促し対象）。 */
  unrankedUserIds: string[];
}

const hasRankedAccount = (ranks: string[]): boolean => ranks.some((r) => majorTierOf(r) !== null);

/**
 * 指定スロット時点での少人数(2〜3人)パーティ提案を組み立てる純粋関数。
 * - スロットまでに参加可能（availableFromUtc ≤ slotUtc）な確定者を候補にする。
 * - 複数アカウント・ランク制限を考慮して最良パーティを探す。
 * - 採用されずランクも取れない参加可能者は登録促し対象として返す。
 * 成立パーティが無ければ null。
 */
export function buildSmallPartyProposal(
  confirmed: ConfirmedEntryInput[],
  ranksByUser: Map<string, string[]>,
  slotUtc: string,
): SmallPartyProposal | null {
  const slotMs = new Date(slotUtc).getTime();
  const available = confirmed.filter(
    (e) =>
      allowsSmallParty(e.partySizePreference) && new Date(e.availableFromUtc).getTime() <= slotMs,
  );

  if (available.length < 2) return null;

  const candidates: SmallPartyCandidate[] = available.map((e) => ({
    userId: e.userId,
    availableFromUtc: e.availableFromUtc,
    createdAtUtc: e.createdAtUtc,
    accountRanks: ranksByUser.get(e.userId) ?? [],
  }));

  const party = findBestSmallParty(candidates);
  if (!party) return null;

  const memberSet = new Set(party.memberIds);
  const unrankedUserIds = available
    .filter((e) => !memberSet.has(e.userId) && !hasRankedAccount(ranksByUser.get(e.userId) ?? []))
    .map((e) => e.userId);

  return { party, unrankedUserIds };
}

/**
 * 少人数パーティ通知メッセージ本文（同意ボタンは無く、純粋な案内）。
 * earlierMeetTimeUtc / earlierMemberIds が与えられれば、全員集合より早く始められる
 * サブ組の案内を1行追記する。
 */
export function formatSmallPartyProposal(
  memberIds: string[],
  meetTimeUtc: string,
  size: number,
  tz: string,
  earlier?: { memberIds: string[]; meetTimeUtc: string },
): string {
  const members = memberIds.map((id) => `<@${id}>`).join(" ");
  const lines = [
    `📣 ランク条件を満たす${size}人で行けそうです！`,
    `🕘 集合時刻: ${utcToLocalHHmm(meetTimeUtc, tz)}`,
    `👥 メンバー: ${members}`,
  ];

  if (earlier && earlier.memberIds.length > 0) {
    const earlierMembers = earlier.memberIds.map((id) => `<@${id}>`).join(" ");
    lines.push(
      `⏰ 早く始めるなら: ${earlierMembers} は ${utcToLocalHHmm(earlier.meetTimeUtc, tz)} から行けます`,
    );
  }

  return lines.join("\n");
}

/** Riotアカウント未登録ユーザーへの登録促しメッセージ。 */
export function formatRegisterNudge(userIds: string[]): string {
  const mentions = userIds.map((id) => `<@${id}>`).join(" ");
  return `${mentions} Riotアカウント未登録のため少人数マッチングの対象外です。\`/riot add\` で登録してください。`;
}
