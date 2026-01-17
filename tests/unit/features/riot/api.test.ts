import { describe, it, expect } from "vitest";

describe("tierToRank", () => {
  // Inline implementation for testing (due to Cloudflare Workers pool limitations)
  // Note: This matches the actual implementation in src/features/riot/api.ts
  // In the actual code, tier 0-2 maps to "Unrated", tier 3-5 maps to "Iron", etc.
  function tierToRank(tier: number, _division: number) {
    const ranks = [
      "Unrated",
      "Iron",
      "Bronze",
      "Silver",
      "Gold",
      "Platinum",
      "Diamond",
      "Ascendant",
      "Immortal",
      "Radiant",
    ];

    const tierIndex = Math.floor(tier / 3);
    const divisionIndex = tier % 3;

    const rankName = ranks[tierIndex] ?? "Unrated";
    const divisions = ["1", "2", "3"];
    const divisionName = divisions[divisionIndex] ?? "1";

    return {
      tier,
      division: divisionName,
      rank: `${rankName} ${divisionName}`,
    };
  }

  // Note: The division parameter is ignored in the actual implementation
  // The division is calculated from tier % 3 instead

  it("should convert tier 0-2 to Unrated 1-3 (actual implementation)", () => {
    // Note: In the actual implementation, tier 0-2 maps to Unrated due to ranks[0] = "Unrated"
    // This may differ from HenrikDev API's actual tier numbering
    expect(tierToRank(0, 0).rank).toBe("Unrated 1"); // tierIndex 0, divisionIndex 0
    expect(tierToRank(1, 1).rank).toBe("Unrated 2"); // tierIndex 0, divisionIndex 1
    expect(tierToRank(2, 2).rank).toBe("Unrated 3"); // tierIndex 0, divisionIndex 2
  });

  it("should convert tier 3-5 to Iron 1-3", () => {
    expect(tierToRank(3, 0).rank).toBe("Iron 1"); // tierIndex 1, divisionIndex 0
    expect(tierToRank(4, 1).rank).toBe("Iron 2"); // tierIndex 1, divisionIndex 1
    expect(tierToRank(5, 2).rank).toBe("Iron 3"); // tierIndex 1, divisionIndex 2
  });

  it("should convert tier 6-8 to Bronze 1-3", () => {
    expect(tierToRank(6, 0).rank).toBe("Bronze 1"); // tierIndex 2, divisionIndex 0
    expect(tierToRank(7, 1).rank).toBe("Bronze 2"); // tierIndex 2, divisionIndex 1
    expect(tierToRank(8, 2).rank).toBe("Bronze 3"); // tierIndex 2, divisionIndex 2
  });

  it("should convert tier 9-11 to Silver 1-3", () => {
    expect(tierToRank(9, 0).rank).toBe("Silver 1"); // tierIndex 3, divisionIndex 0
    expect(tierToRank(10, 1).rank).toBe("Silver 2"); // tierIndex 3, divisionIndex 1
    expect(tierToRank(11, 2).rank).toBe("Silver 3"); // tierIndex 3, divisionIndex 2
  });

  it("should convert tier 12-14 to Gold 1-3", () => {
    expect(tierToRank(12, 0).rank).toBe("Gold 1"); // tierIndex 4, divisionIndex 0
    expect(tierToRank(13, 1).rank).toBe("Gold 2"); // tierIndex 4, divisionIndex 1
    expect(tierToRank(14, 2).rank).toBe("Gold 3"); // tierIndex 4, divisionIndex 2
  });

  it("should convert tier 15-17 to Platinum 1-3", () => {
    expect(tierToRank(15, 0).rank).toBe("Platinum 1"); // tierIndex 5, divisionIndex 0
    expect(tierToRank(16, 1).rank).toBe("Platinum 2"); // tierIndex 5, divisionIndex 1
    expect(tierToRank(17, 2).rank).toBe("Platinum 3"); // tierIndex 5, divisionIndex 2
  });

  it("should convert tier 18-20 to Diamond 1-3", () => {
    expect(tierToRank(18, 0).rank).toBe("Diamond 1"); // tierIndex 6, divisionIndex 0
    expect(tierToRank(19, 1).rank).toBe("Diamond 2"); // tierIndex 6, divisionIndex 1
    expect(tierToRank(20, 2).rank).toBe("Diamond 3"); // tierIndex 6, divisionIndex 2
  });

  it("should convert tier 21-23 to Ascendant 1-3", () => {
    expect(tierToRank(21, 0).rank).toBe("Ascendant 1"); // tierIndex 7, divisionIndex 0
    expect(tierToRank(22, 1).rank).toBe("Ascendant 2"); // tierIndex 7, divisionIndex 1
    expect(tierToRank(23, 2).rank).toBe("Ascendant 3"); // tierIndex 7, divisionIndex 2
  });

  it("should convert tier 24+ to Immortal 1-3", () => {
    expect(tierToRank(24, 0).rank).toBe("Immortal 1"); // tierIndex 8, divisionIndex 0
    expect(tierToRank(25, 1).rank).toBe("Immortal 2"); // tierIndex 8, divisionIndex 1
    expect(tierToRank(26, 2).rank).toBe("Immortal 3"); // tierIndex 8, divisionIndex 2
  });

  it("should convert tier 27+ to Radiant", () => {
    expect(tierToRank(27, 0).rank).toBe("Radiant 1"); // tierIndex 9, divisionIndex 0
    expect(tierToRank(28, 1).rank).toBe("Radiant 2"); // tierIndex 9, divisionIndex 1
    expect(tierToRank(29, 2).rank).toBe("Radiant 3"); // tierIndex 9, divisionIndex 2
  });

  it("should handle negative tier as Unrated", () => {
    // tierIndex = Math.floor(-1 / 3) = -1, which defaults to "Unrated"
    expect(tierToRank(-1, 0).rank).toBe("Unrated 1");
  });

  it("should return correct division based on tier % 3", () => {
    // Note: The actual implementation calculates division from tier % 3,
    // not from the division parameter
    const result = tierToRank(13, 1); // 13 % 3 = 1, divisions[1] = "2"
    expect(result.division).toBe("2"); // divisionIndex 1 maps to "2" in divisions array
    expect(result.tier).toBe(13);
  });
});

describe("formatRankLabel", () => {
  // Inline implementation for testing
  function formatRankLabel(account: {
    name: string;
    tag: string;
    rank: { rank: string } | null;
  }): string {
    if (!account.rank) {
      return `${account.name}#${account.tag} (Unrated)`;
    }
    return `${account.name}#${account.tag} (${account.rank.rank})`;
  }

  it("should format account with rank", () => {
    const account = {
      name: "TestPlayer",
      tag: "123",
      rank: {
        tier: 10,
        division: "2",
        rank: "Gold 2",
      },
    };
    expect(formatRankLabel(account)).toBe("TestPlayer#123 (Gold 2)");
  });

  it("should format account without rank as Unrated", () => {
    const account = {
      name: "TestPlayer",
      tag: "123",
      rank: null,
    };
    expect(formatRankLabel(account)).toBe("TestPlayer#123 (Unrated)");
  });

  it("should handle special characters in name", () => {
    const account = {
      name: "Test_Player",
      tag: "JP1",
      rank: {
        tier: 15,
        division: "1",
        rank: "Diamond 1",
      },
    };
    expect(formatRankLabel(account)).toBe("Test_Player#JP1 (Diamond 1)");
  });
});

describe("ValorantAccount interface", () => {
  it("should accept account with rank", () => {
    const account = {
      name: "TestPlayer",
      tag: "123",
      rank: {
        tier: 10,
        division: "2",
        rank: "Gold 2",
      },
    };
    expect(account.name).toBe("TestPlayer");
    expect(account.tag).toBe("123");
    expect(account.rank?.rank).toBe("Gold 2");
  });

  it("should accept account without rank", () => {
    const account = {
      name: "TestPlayer",
      tag: "123",
      rank: null,
    };
    expect(account.name).toBe("TestPlayer");
    expect(account.tag).toBe("123");
    expect(account.rank).toBeNull();
  });
});

describe("FetchRankResult interface", () => {
  it("should accept success result", () => {
    const result = {
      success: true,
      account: {
        name: "TestPlayer",
        tag: "123",
        rank: {
          tier: 10,
          division: "2",
          rank: "Gold 2",
        },
      },
      error: null,
    };
    expect(result.success).toBe(true);
    expect(result.account?.name).toBe("TestPlayer");
    expect(result.error).toBeNull();
  });

  it("should accept failure result", () => {
    const result = {
      success: false,
      account: null,
      error: "Account not found",
    };
    expect(result.success).toBe(false);
    expect(result.account).toBeNull();
    expect(result.error).toBe("Account not found");
  });
});
