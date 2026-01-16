export interface Entry {
  userId: string;
  availableFromUtc: string;
  rank?: string;
}

export interface BestParty {
  memberIds: string[];
  meetTimeUtc: string;
  rankBalanceScore?: number;
}

// ランク階層定義 (低い順)
const RANK_HIERARCHY = [
  "Unrated",
  "Iron 1",
  "Iron 2",
  "Iron 3",
  "Bronze 1",
  "Bronze 2",
  "Bronze 3",
  "Silver 1",
  "Silver 2",
  "Silver 3",
  "Gold 1",
  "Gold 2",
  "Gold 3",
  "Platinum 1",
  "Platinum 2",
  "Platinum 3",
  "Diamond 1",
  "Diamond 2",
  "Diamond 3",
  "Ascendant 1",
  "Ascendant 2",
  "Ascendant 3",
  "Immortal 1",
  "Immortal 2",
  "Immortal 3",
  "Radiant",
];

function getRankLevel(rank: string): number {
  const index = RANK_HIERARCHY.indexOf(rank);
  return index >= 0 ? index : 0;
}

function calculateRankVariance(entries: Entry[]): number {
  if (entries.length === 0) return 0;

  const ranks = entries
    .map((e) => (e.rank ? getRankLevel(e.rank) : 0))
    .filter((r) => r > 0);

  if (ranks.length === 0) return 0;

  const mean = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
  const variance =
    ranks.reduce((sum, r) => sum + (r - mean) ** 2, 0) / ranks.length;

  return variance;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];

  const [first, ...rest] = arr;
  const combsWithFirst = combinations(rest, k - 1).map((comb) => [
    first,
    ...comb,
  ]);
  const combsWithoutFirst = combinations(rest, k);

  return [...combsWithFirst, ...combsWithoutFirst];
}

function sumAvailableFrom(entries: Entry[]): number {
  return entries.reduce(
    (sum, e) => sum + new Date(e.availableFromUtc).getTime(),
    0,
  );
}

export function computeBestParty(entries: Entry[]): BestParty {
  if (entries.length <= 5) {
    const memberIds = entries.map((e) => e.userId);
    const meetTime = entries.reduce((latest, e) => {
      const t = new Date(e.availableFromUtc);
      return t.getTime() > latest.getTime() ? t : latest;
    }, new Date("1970-01-01T00:00:00.000Z"));
    return {
      memberIds,
      meetTimeUtc: meetTime.toISOString(),
      rankBalanceScore: calculateRankVariance(entries),
    };
  }

  let best: BestParty | null = null;
  let bestMeetTime = Number.POSITIVE_INFINITY;
  let bestSum = Number.POSITIVE_INFINITY;
  let bestRankVariance = Number.POSITIVE_INFINITY;

  for (const combo of combinations(entries, 5)) {
    const meetTime = combo.reduce((latest, e) => {
      const t = new Date(e.availableFromUtc);
      return t.getTime() > latest.getTime() ? t : latest;
    }, new Date("1970-01-01T00:00:00.000Z"));

    const meetTimeValue = meetTime.getTime();
    const rankVariance = calculateRankVariance(combo);

    if (meetTimeValue < bestMeetTime) {
      bestMeetTime = meetTimeValue;
      bestSum = sumAvailableFrom(combo);
      bestRankVariance = rankVariance;
      best = {
        memberIds: combo.map((e) => e.userId).sort(),
        meetTimeUtc: meetTime.toISOString(),
        rankBalanceScore: rankVariance,
      };
    } else if (meetTimeValue === bestMeetTime) {
      const currentSum = sumAvailableFrom(combo);
      // ランク分散が小さい方を優先
      if (
        rankVariance < bestRankVariance ||
        (rankVariance === bestRankVariance && currentSum < bestSum)
      ) {
        bestSum = currentSum;
        bestRankVariance = rankVariance;
        best = {
          memberIds: combo.map((e) => e.userId).sort(),
          meetTimeUtc: meetTime.toISOString(),
          rankBalanceScore: rankVariance,
        };
      }
    }
  }

  return best ?? { memberIds: [], meetTimeUtc: "1970-01-01T00:00:00.000Z", rankBalanceScore: 0 };
}

export function formatRankEvaluation(entries: Entry[]): string {
  if (entries.length === 0) {
    return "参加者がいません";
  }

  const ranks = entries
    .map((e) => e.rank)
    .filter((r): r is string => r !== undefined);

  if (ranks.length === 0) {
    return "ランク情報がありません";
  }

  const rankCounts = new Map<string, number>();
  for (const rank of ranks) {
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  const uniqueRanks = Array.from(rankCounts.entries()).sort(
    (a, b) => getRankLevel(b[0]) - getRankLevel(a[0]),
  );

  const rankList = uniqueRanks
    .map(([rank, count]) => `${rank}: ${count}人`)
    .join(", ");

  const variance = calculateRankVariance(entries);
  const balanceRating =
    variance < 10
      ? "良好"
      : variance < 30
        ? "やや不平衡"
        : "不平衡";

  return `ランク構成: ${rankList}\nバランス評価: ${balanceRating}`;
}

export function selectOptimalAccounts(
  userId: string,
  accounts: { rank: string }[],
  neededSlots: number,
): string[] {
  if (accounts.length <= neededSlots) {
    return accounts.map((_, i) => `${userId}-${i}`);
  }

  // ランクが近いアカウント同士を選択するため、ランクでソート
  const sortedAccounts = [...accounts].sort(
    (a, b) => getRankLevel(a.rank) - getRankLevel(b.rank),
  );

  // 連続したランクのアカウントを選択（最小分散）
  let bestCombination: typeof sortedAccounts = [];
  let minVariance = Number.POSITIVE_INFINITY;

  for (let i = 0; i <= sortedAccounts.length - neededSlots; i++) {
    const combination = sortedAccounts.slice(i, i + neededSlots);
    const variance = calculateRankVariance(
      combination.map((acc) => ({ userId: "dummy", availableFromUtc: "1970-01-01T00:00:00.000Z", rank: acc.rank })),
    );

    if (variance < minVariance) {
      minVariance = variance;
      bestCombination = combination;
    }
  }

  return bestCombination.map((_, i) => `${userId}-${sortedAccounts.indexOf(bestCombination[0]) + i}`);
}
