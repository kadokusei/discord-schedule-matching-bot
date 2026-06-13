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

/**
 * ランク制限を満たす最良の 2〜3 人パーティを探索する。
 * - 大きいパーティ（3）を 2 より優先する。
 * - 各ユーザーの複数アカウントから、制限を満たし分散が最小になるランクを選ぶ。
 * - 同サイズ内の優先順位: 集合時刻が早い → 参加申込が早い(createdAt合計小) → ランク分散小。
 * - ランクを取得できないユーザー（Unrated/未登録のみ）は候補から除外する。
 * 成立するパーティが無ければ null。
 */
export function findBestSmallParty(candidates: SmallPartyCandidate[]): SmallParty | null {
  const ranked: RankedCandidate[] = candidates
    .map((c) => ({
      userId: c.userId,
      availableFromUtc: c.availableFromUtc,
      createdAtUtc: c.createdAtUtc,
      rankedAccounts: c.accountRanks
        .map((rank) => ({ rank, tier: majorTierOf(rank) }))
        .filter((a): a is { rank: string; tier: number } => a.tier !== null),
    }))
    .filter((c) => c.rankedAccounts.length > 0);

  const maxSize = Math.min(3, ranked.length);

  for (let size = maxSize; size >= 2; size--) {
    let best: SmallParty | null = null;
    let bestMeetTime = Number.POSITIVE_INFINITY;
    let bestSumCreatedAt = Number.POSITIVE_INFINITY;
    let bestVariance = Number.POSITIVE_INFINITY;

    for (const combo of combinations(ranked, size)) {
      // この組み合わせで制限を満たす最小分散のランク選択を探す
      let comboRanks: { rank: string; tier: number }[] | null = null;
      let comboVariance = Number.POSITIVE_INFINITY;

      for (const selection of rankSelections(combo)) {
        if (!canQueueAsParty(selection.map((a) => a.tier))) continue;
        const v = variance(selection.map((a) => rankLevel(a.rank)));
        if (v < comboVariance) {
          comboVariance = v;
          comboRanks = selection;
        }
      }

      if (!comboRanks) continue;

      const meetTimeUtc = latestAvailableFrom(combo);
      const meetTimeValue = new Date(meetTimeUtc).getTime();
      const sumCreated = sumCreatedAt(combo);

      const better =
        meetTimeValue < bestMeetTime ||
        (meetTimeValue === bestMeetTime &&
          (sumCreated < bestSumCreatedAt ||
            (sumCreated === bestSumCreatedAt && comboVariance < bestVariance)));

      if (better) {
        bestMeetTime = meetTimeValue;
        bestSumCreatedAt = sumCreated;
        bestVariance = comboVariance;

        const chosenRanks: Record<string, string> = {};
        combo.forEach((m, i) => {
          chosenRanks[m.userId] = comboRanks[i].rank;
        });

        best = {
          memberIds: combo.map((m) => m.userId).sort(),
          meetTimeUtc,
          size,
          chosenRanks,
          rankBalanceScore: comboVariance,
        };
      }
    }

    if (best) return best;
  }

  return null;
}
