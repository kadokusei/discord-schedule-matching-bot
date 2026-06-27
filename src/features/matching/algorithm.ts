export interface Entry {
  userId: string;
  availableFromUtc: string;
  rank?: string;
  createdAtUtc: string;
}

export interface BestParty {
  memberIds: string[];
  meetTimeUtc: string;
  rankBalanceScore?: number;
}

// ランク階層定義 (低い順)
export const RANK_HIERARCHY = [
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

  const ranks = entries.map((e) => (e.rank ? getRankLevel(e.rank) : 0)).filter((r) => r > 0);

  if (ranks.length === 0) return 0;

  const mean = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
  const variance = ranks.reduce((sum, r) => sum + (r - mean) ** 2, 0) / ranks.length;

  return variance;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];

  const [first, ...rest] = arr;
  const combsWithFirst = combinations(rest, k - 1).map((comb) => [first, ...comb]);
  const combsWithoutFirst = combinations(rest, k);

  return [...combsWithFirst, ...combsWithoutFirst];
}

function sumCreatedAt(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + new Date(e.createdAtUtc).getTime(), 0);
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
  let bestSumCreatedAt = Number.POSITIVE_INFINITY;
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
      bestSumCreatedAt = sumCreatedAt(combo);
      bestRankVariance = rankVariance;
      best = {
        memberIds: combo.map((e) => e.userId).sort(),
        meetTimeUtc: meetTime.toISOString(),
        rankBalanceScore: rankVariance,
      };
    } else if (meetTimeValue === bestMeetTime) {
      const sumCreatedAtValue = sumCreatedAt(combo);
      // 回答時間が早いユーザー優先
      if (
        sumCreatedAtValue < bestSumCreatedAt ||
        (sumCreatedAtValue === bestSumCreatedAt && rankVariance < bestRankVariance)
      ) {
        bestSumCreatedAt = sumCreatedAtValue;
        bestRankVariance = rankVariance;
        best = {
          memberIds: combo.map((e) => e.userId).sort(),
          meetTimeUtc: meetTime.toISOString(),
          rankBalanceScore: rankVariance,
        };
      }
    }
  }

  return (
    best ?? {
      memberIds: [],
      meetTimeUtc: "1970-01-01T00:00:00.000Z",
      rankBalanceScore: 0,
    }
  );
}
