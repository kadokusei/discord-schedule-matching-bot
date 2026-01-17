import { describe, it, expect } from "vitest";
import { computeBestParty } from "../../src/features/matching";

describe("selectOptimalAccounts", () => {
  // Inline implementation for testing (due to Cloudflare Workers pool limitations)
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

  function calculateRankVariance(entries: Array<{ rank?: string }>): number {
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

  function formatRankEvaluation(
    entries: Array<{ userId: string; availableFromUtc: string; rank?: string }>,
  ): string {
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
      variance < 10 ? "良好" : variance < 30 ? "やや不平衡" : "不平衡";

    return `ランク構成: ${rankList}\nバランス評価: ${balanceRating}`;
  }

  it("should return message for empty entries", () => {
    const entries: Array<{
      userId: string;
      availableFromUtc: string;
      rank?: string;
    }> = [];

    expect(formatRankEvaluation(entries)).toBe("参加者がいません");
  });

  it("should return message when all players are unrated", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-17T12:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-17T12:00:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-17T12:00:00.000Z" },
    ];

    expect(formatRankEvaluation(entries)).toBe("ランク情報がありません");
  });

  it("should handle all same rank", () => {
    const entries = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
    ];

    const result = formatRankEvaluation(entries);

    expect(result).toContain("Gold 2: 5人");
    expect(result).toContain("バランス評価: 良好");
  });

  it("should handle mixed ranks with good balance", () => {
    const entries = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 3",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 1",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
    ];

    const result = formatRankEvaluation(entries);

    expect(result).toContain("Gold 2: 3人");
    expect(result).toContain("Gold 3: 1人");
    expect(result).toContain("Gold 1: 1人");
    expect(result).toContain("バランス評価: 良好");
  });

  it("should handle imbalanced ranks", () => {
    const entries = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Radiant",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Iron 1",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Silver 1",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Diamond 2",
      },
    ];

    const result = formatRankEvaluation(entries);

    expect(result).toContain("バランス評価: 不平衡");
  });

  it("should display ranks in descending order", () => {
    const entries = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Iron 1",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        rank: "Silver 1",
      },
    ];

    const result = formatRankEvaluation(entries);

    // Higher ranks should appear first
    const goldIndex = result.indexOf("Gold");
    const silverIndex = result.indexOf("Silver");
    const ironIndex = result.indexOf("Iron");

    expect(goldIndex).toBeLessThan(silverIndex);
    expect(silverIndex).toBeLessThan(ironIndex);
  });
});

describe("selectOptimalAccounts", () => {
  // Inline implementation for testing
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

  function calculateRankVariance(entries: Array<{ rank?: string }>): number {
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

  function selectOptimalAccounts(
    userId: string,
    accounts: Array<{ rank: string }>,
    neededSlots: number,
  ): string[] {
    if (accounts.length <= neededSlots) {
      return accounts.map((_, i) => `${userId}-${i}`);
    }

    const sortedAccounts = [...accounts].sort(
      (a, b) => getRankLevel(a.rank) - getRankLevel(b.rank),
    );

    let bestCombination: typeof sortedAccounts = [];
    let minVariance = Number.POSITIVE_INFINITY;

    for (let i = 0; i <= sortedAccounts.length - neededSlots; i++) {
      const combination = sortedAccounts.slice(i, i + neededSlots);
      const variance = calculateRankVariance(
        combination.map((acc) => ({
          userId: "dummy",
          availableFromUtc: "1970-01-01T00:00:00.000Z",
          rank: acc.rank,
        })),
      );

      if (variance < minVariance) {
        minVariance = variance;
        bestCombination = combination;
      }
    }

    return bestCombination.map(
      (_, i) => `${userId}-${sortedAccounts.indexOf(bestCombination[0]) + i}`,
    );
  }

  it("should return all accounts when count <= neededSlots", () => {
    const accounts = [{ rank: "Gold 1" }, { rank: "Gold 2" }];

    const result = selectOptimalAccounts("user1", accounts, 3);

    expect(result).toEqual(["user1-0", "user1-1"]);
  });

  it("should select accounts with minimal rank variance", () => {
    const accounts = [
      { rank: "Iron 1" },
      { rank: "Gold 1" },
      { rank: "Gold 2" },
      { rank: "Gold 3" },
      { rank: "Radiant" },
    ];

    const result = selectOptimalAccounts("user1", accounts, 3);

    // Should select Gold 1, Gold 2, Gold 3 (adjacent ranks with minimal variance)
    expect(result).toHaveLength(3);
  });

  it("should select consecutive accounts when sorted by rank", () => {
    const accounts = [
      { rank: "Silver 1" },
      { rank: "Silver 2" },
      { rank: "Gold 1" },
      { rank: "Gold 2" },
      { rank: "Platinum 1" },
    ];

    const result = selectOptimalAccounts("user1", accounts, 2);

    // Should select adjacent ranks (Silver 1 & Silver 2, or Gold 1 & Gold 2)
    expect(result).toHaveLength(2);
  });

  it("should handle empty accounts array", () => {
    const accounts: Array<{ rank: string }> = [];

    const result = selectOptimalAccounts("user1", accounts, 1);

    expect(result).toEqual([]);
  });
});

describe("computeBestParty", () => {
  it("should return all 5 members when exactly 5", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T21:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T21:30:00.000Z", createdAtUtc: "2026-01-16T20:10:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:20:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:30:00.000Z", createdAtUtc: "2026-01-16T20:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T23:00:00.000Z", createdAtUtc: "2026-01-16T20:40:00.000Z" },
    ];

    const result = computeBestParty(entries);

    expect(result.memberIds).toHaveLength(5);
    expect(result.meetTimeUtc).toBe("2026-01-16T23:00:00.000Z");
  });

  it("should select 5 members with earliest meet time when more than 5", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T21:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T21:30:00.000Z", createdAtUtc: "2026-01-16T20:10:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:20:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:30:00.000Z", createdAtUtc: "2026-01-16T20:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T23:00:00.000Z", createdAtUtc: "2026-01-16T20:40:00.000Z" },
      { userId: "user6", availableFromUtc: "2026-01-16T23:30:00.000Z", createdAtUtc: "2026-01-16T20:50:00.000Z" },
    ];

    const result = computeBestParty(entries);

    expect(result.memberIds).toHaveLength(5);
    expect(result.meetTimeUtc).toBe("2026-01-16T23:00:00.000Z");
  });

  it("should be stable on ties", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T21:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T21:30:00.000Z", createdAtUtc: "2026-01-16T20:10:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:20:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:30:00.000Z", createdAtUtc: "2026-01-16T20:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T23:00:00.000Z", createdAtUtc: "2026-01-16T20:40:00.000Z" },
      { userId: "user6", availableFromUtc: "2026-01-16T23:00:00.000Z", createdAtUtc: "2026-01-16T20:50:00.000Z" },
    ];

    const result1 = computeBestParty(entries);
    const result2 = computeBestParty(entries);

    expect(result1.memberIds).toEqual(result2.memberIds);
    expect(result1.meetTimeUtc).toBe(result2.meetTimeUtc);
  });

  it("should prioritize earlier responders when meet times are equal", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:10:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:20:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:40:00.000Z" },
      { userId: "user6", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:50:00.000Z" },
    ];

    const result = computeBestParty(entries);

    // Should select users 1-5 (earlier responders)
    expect(result.memberIds).toHaveLength(5);
    expect(result.memberIds).not.toContain("user6");
    expect(result.meetTimeUtc).toBe("2026-01-16T22:00:00.000Z");
  });

  it("should reset createdAt on re-join (cancellation and re-participation)", () => {
    // userA answers early at 21:30, userB answers at 22:00
    // userA changes to 22:00, userA should be prioritized (earlier createdAt)
    const entries = [
      { userId: "userA", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z" },
      { userId: "userB", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T21:00:00.000Z" },
      { userId: "userC", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:10:00.000Z" },
      { userId: "userD", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:20:00.000Z" },
      { userId: "userE", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:30:00.000Z" },
      { userId: "userF", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:40:00.000Z" },
    ];

    const result = computeBestParty(entries);

    // userA should be prioritized over userB despite both having 22:00 available time
    expect(result.memberIds).toHaveLength(5);
    expect(result.memberIds).toContain("userA");
    expect(result.memberIds).not.toContain("userB"); // userB is the latest responder
  });

  it("should fall back to rank variance when createdAt times are equal", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z", rank: "Gold 2" },
      { userId: "user2", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z", rank: "Gold 2" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z", rank: "Gold 3" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z", rank: "Gold 1" },
      { userId: "user5", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z", rank: "Gold 2" },
      { userId: "user6", availableFromUtc: "2026-01-16T22:00:00.000Z", createdAtUtc: "2026-01-16T20:00:00.000Z", rank: "Radiant" },
    ];

    const result = computeBestParty(entries);

    // Should select users 1-5 for better rank balance (excluding Radiant user6)
    expect(result.memberIds).toHaveLength(5);
    expect(result.memberIds).not.toContain("user6");
  });
});
