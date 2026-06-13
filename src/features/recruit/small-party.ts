import {
  type SmallParty,
  type SmallPartyCandidate,
  findBestSmallParty,
  majorTierOf,
} from "../matching";
import { utcToLocalHHmm } from "./notification";

export interface ConfirmedEntryInput {
  userId: string;
  availableFromUtc: string;
  createdAtUtc: string;
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
  const available = confirmed.filter((e) => new Date(e.availableFromUtc).getTime() <= slotMs);

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

/** 少人数パーティ提案メッセージ本文（同意ボタンと併せて投稿する）。 */
export function formatSmallPartyProposal(
  memberIds: string[],
  meetTimeUtc: string,
  size: number,
  tz: string,
): string {
  const members = memberIds.map((id) => `<@${id}>`).join(" ");
  return [
    `📣 ランク条件を満たす${size}人で行けそうです！`,
    `🕘 集合時刻: ${utcToLocalHHmm(meetTimeUtc, tz)}`,
    `👥 メンバー: ${members}`,
    "対象メンバー全員が【行く】を押すと確定します。",
  ].join("\n");
}

export interface ConsentResult {
  /** 押下者が提案メンバーに含まれるか。 */
  isMember: boolean;
  /** 更新後の同意ユーザーID一覧（メンバーのみ・重複なし）。 */
  consent: string[];
  /** 全メンバーが同意したか。 */
  allConfirmed: boolean;
}

/**
 * 同意ボタン押下を適用し、更新後の同意集合と確定可否を返す純粋関数。
 * - メンバー外の押下は同意に反映しない。
 * - 同意集合はメンバーに限定し重複を排除する。
 */
export function applyConsent(
  memberIds: string[],
  currentConsent: string[],
  userId: string,
): ConsentResult {
  const memberSet = new Set(memberIds);
  const isMember = memberSet.has(userId);

  const merged = isMember ? [...currentConsent, userId] : currentConsent;
  const consent = [...new Set(merged)].filter((id) => memberSet.has(id));
  const allConfirmed = memberIds.every((id) => consent.includes(id));

  return { isMember, consent, allConfirmed };
}

/** Riotアカウント未登録ユーザーへの登録促しメッセージ。 */
export function formatRegisterNudge(userIds: string[]): string {
  const mentions = userIds.map((id) => `<@${id}>`).join(" ");
  return `${mentions} Riotアカウント未登録のため少人数マッチングの対象外です。\`/riot add\` で登録してください。`;
}
