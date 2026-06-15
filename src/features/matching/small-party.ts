import { RANK_HIERARCHY } from "./algorithm";
import { canQueueAsParty, majorTierOf } from "./rank-restriction";

/** 少人数パーティ探索の入力。accountRanks はそのユーザーの全アカウントのランク文字列。 */
export interface SmallPartyCandidate {
  userId: string;
  availableFromUtc: string;
  createdAtUtc: string;
  accountRanks: string[];
}

/** 少人数パーティ探索の結果。 */
export interface SmallParty {
  memberIds: string[];
  meetTimeUtc: string;
  size: number;
  /** 各メンバーが使用するランク（採用したアカウントのランク文字列）。 */
  chosenRanks: Record<string, string>;
  rankBalanceScore: number;
}

interface RankedCandidate {
  userId: string;
  availableFromUtc: string;
  createdAtUtc: string;
  /** ランク制限の対象にできる（メジャーティアが算出できる）ランクのみ。 */
  rankedAccounts: { rank: string; tier: number }[];
}

function rankLevel(rank: string): number {
  const index = RANK_HIERARCHY.indexOf(rank);
  return index >= 0 ? index : 0;
}

function variance(levels: number[]): number {
  if (levels.length === 0) return 0;
  const mean = levels.reduce((sum, l) => sum + l, 0) / levels.length;
  return levels.reduce((sum, l) => sum + (l - mean) ** 2, 0) / levels.length;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

/** 各メンバーの候補ランクからアカウント選択の直積を生成する。 */
function rankSelections(members: RankedCandidate[]): { rank: string; tier: number }[][] {
  return members.reduce<{ rank: string; tier: number }[][]>(
    (acc, member) => acc.flatMap((sel) => member.rankedAccounts.map((a) => [...sel, a])),
    [[]],
  );
}

function latestAvailableFrom(members: RankedCandidate[]): string {
  return members
    .map((m) => m.availableFromUtc)
    .reduce((latest, cur) => (new Date(cur) > new Date(latest) ? cur : latest));
}

function sumCreatedAt(members: RankedCandidate[]): number {
  return members.reduce((sum, m) => sum + new Date(m.createdAtUtc).getTime(), 0);
}

/** 候補をランク制限の対象にできるアカウントだけに整形し、対象が無いユーザーを除外する。 */
function toRankedCandidates(candidates: SmallPartyCandidate[]): RankedCandidate[] {
  return candidates
    .map((c) => ({
      userId: c.userId,
      availableFromUtc: c.availableFromUtc,
      createdAtUtc: c.createdAtUtc,
      rankedAccounts: c.accountRanks
        .map((rank) => ({ rank, tier: majorTierOf(rank) }))
        .filter((a): a is { rank: string; tier: number } => a.tier !== null),
    }))
    .filter((c) => c.rankedAccounts.length > 0);
}

/**
 * この組み合わせで制限を満たす最小分散のランク選択を返す。
 * 成立する選択が無ければ null。
 */
function bestRankSelectionForCombo(
  combo: RankedCandidate[],
): { ranks: { rank: string; tier: number }[]; variance: number } | null {
  let best: { rank: string; tier: number }[] | null = null;
  let bestVariance = Number.POSITIVE_INFINITY;

  for (const selection of rankSelections(combo)) {
    if (!canQueueAsParty(selection.map((a) => a.tier))) continue;
    const v = variance(selection.map((a) => rankLevel(a.rank)));
    if (v < bestVariance) {
      bestVariance = v;
      best = selection;
    }
  }

  return best ? { ranks: best, variance: bestVariance } : null;
}

function buildParty(
  combo: RankedCandidate[],
  comboRanks: { rank: string; tier: number }[],
  comboVariance: number,
): SmallParty {
  const chosenRanks: Record<string, string> = {};
  combo.forEach((m, i) => {
    chosenRanks[m.userId] = comboRanks[i].rank;
  });

  return {
    memberIds: combo.map((m) => m.userId).sort(),
    meetTimeUtc: latestAvailableFrom(combo),
    size: combo.length,
    chosenRanks,
    rankBalanceScore: comboVariance,
  };
}

/**
 * ランク制限を満たす最良の 2〜3 人パーティを探索する。
 * - 大きいパーティ（3）を 2 より優先する。
 * - 各ユーザーの複数アカウントから、制限を満たし分散が最小になるランクを選ぶ。
 * - 同サイズ内の優先順位: 集合時刻が早い → 参加申込が早い(createdAt合計小) → ランク分散小。
 * - ランクを取得できないユーザー（Unrated/未登録のみ）は候補から除外する。
 * 成立するパーティが無ければ null。
 */
export function findBestSmallParty(candidates: SmallPartyCandidate[]): SmallParty | null {
  const ranked = toRankedCandidates(candidates);
  const maxSize = Math.min(3, ranked.length);

  for (let size = maxSize; size >= 2; size--) {
    let best: SmallParty | null = null;
    let bestMeetTime = Number.POSITIVE_INFINITY;
    let bestSumCreatedAt = Number.POSITIVE_INFINITY;
    let bestVariance = Number.POSITIVE_INFINITY;

    for (const combo of combinations(ranked, size)) {
      const selection = bestRankSelectionForCombo(combo);
      if (!selection) continue;

      const meetTimeValue = new Date(latestAvailableFrom(combo)).getTime();
      const sumCreated = sumCreatedAt(combo);

      const better =
        meetTimeValue < bestMeetTime ||
        (meetTimeValue === bestMeetTime &&
          (sumCreated < bestSumCreatedAt ||
            (sumCreated === bestSumCreatedAt && selection.variance < bestVariance)));

      if (better) {
        bestMeetTime = meetTimeValue;
        bestSumCreatedAt = sumCreated;
        bestVariance = selection.variance;
        best = buildParty(combo, selection.ranks, selection.variance);
      }
    }

    if (best) return best;
  }

  return null;
}

/**
 * 対象ユーザーが、他メンバーの誰かと組んで（総勢 2〜3 人）ランク差制限を満たす
 * パーティを 1 つでも作れるかを判定する。時間は考慮しない（ランク適合性のみ）。
 * - targetRanks / otherRanks はアカウントのランク文字列配列（複数アカウント対応）。
 * - ランク取得可能アカウントが無い場合は false（アカウント未登録/Unrated も false）。
 */
export function canUserJoinAnyParty(targetRanks: string[], otherRanks: string[][]): boolean {
  const toTiers = (ranks: string[]) =>
    ranks.map((r) => majorTierOf(r)).filter((t): t is number => t !== null);

  const targetTiers = toTiers(targetRanks);
  if (targetTiers.length === 0) return false;

  const others = otherRanks.map(toTiers).filter((t) => t.length > 0);

  // パーティ総人数 2〜3 → target 以外の必要人数 k は 1〜2
  for (let k = 1; k <= Math.min(2, others.length); k++) {
    for (const combo of combinations(others, k)) {
      // target + combo の各メンバーがアカウントを 1 つ選ぶ tier の直積を列挙
      const selections = [targetTiers, ...combo].reduce<number[][]>(
        (acc, tiers) => acc.flatMap((sel) => tiers.map((t) => [...sel, t])),
        [[]],
      );
      if (selections.some((sel) => canQueueAsParty(sel))) return true;
    }
  }

  return false;
}

/**
 * 候補（= 確定パーティのメンバー）から、ランク差制限を満たし集合時刻が beforeUtc より
 * 早く始められる最良サブパーティを返す。全員集合より早い 2〜3 人組の提案に使う。
 * 優先順位: 集合時刻が早い → 人数が多い → ランク分散小 → メンバーID昇順（決定的タイブレーク）。
 * 該当が無ければ null。
 */
export function findEarliestSubParty(
  candidates: SmallPartyCandidate[],
  beforeUtc: string,
): SmallParty | null {
  const ranked = toRankedCandidates(candidates);
  const maxSize = Math.min(3, ranked.length);
  const beforeMs = new Date(beforeUtc).getTime();

  let best: SmallParty | null = null;
  let bestMeetTime = Number.POSITIVE_INFINITY;

  for (let size = 2; size <= maxSize; size++) {
    for (const combo of combinations(ranked, size)) {
      const selection = bestRankSelectionForCombo(combo);
      if (!selection) continue;

      const meetTimeValue = new Date(latestAvailableFrom(combo)).getTime();
      if (meetTimeValue >= beforeMs) continue; // 全員集合より早くないので対象外

      const candidate = buildParty(combo, selection.ranks, selection.variance);

      if (best === null || isEarlierSubPartyBetter(candidate, meetTimeValue, best, bestMeetTime)) {
        best = candidate;
        bestMeetTime = meetTimeValue;
      }
    }
  }

  return best;
}

/** findEarliestSubParty の優先順位比較。candidate が現行 best より良ければ true。 */
function isEarlierSubPartyBetter(
  candidate: SmallParty,
  candidateMeetTime: number,
  best: SmallParty,
  bestMeetTime: number,
): boolean {
  if (candidateMeetTime !== bestMeetTime) return candidateMeetTime < bestMeetTime;
  if (candidate.size !== best.size) return candidate.size > best.size;
  if (candidate.rankBalanceScore !== best.rankBalanceScore) {
    return candidate.rankBalanceScore < best.rankBalanceScore;
  }
  // 決定的タイブレーク: メンバーID列を文字列比較
  return candidate.memberIds.join(",") < best.memberIds.join(",");
}
