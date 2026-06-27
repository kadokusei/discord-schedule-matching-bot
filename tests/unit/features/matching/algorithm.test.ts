import { describe, it, expect } from "vitest";
import { computeBestParty, type Entry } from "../../../../src/features/matching";

describe("rankBalanceScore evaluation", () => {
  it("should return 0 for all same rank", () => {
    const entries: Entry[] = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:10:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:20:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:30:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:40:00.000Z",
        rank: "Gold 2",
      },
    ];

    const result = computeBestParty(entries);

    expect(result.rankBalanceScore).toBe(0);
  });

  it("should return low score for adjacent ranks", () => {
    const entries: Entry[] = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:00:00.000Z",
        rank: "Gold 1",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:10:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:20:00.000Z",
        rank: "Gold 3",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:30:00.000Z",
        rank: "Platinum 1",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:40:00.000Z",
        rank: "Platinum 2",
      },
    ];

    const result = computeBestParty(entries);

    // Adjacent ranks should have low variance
    expect(result.rankBalanceScore).toBeLessThan(10);
  });

  it("should return high score for imbalanced ranks", () => {
    const entries: Entry[] = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:00:00.000Z",
        rank: "Iron 1",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:10:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:20:00.000Z",
        rank: "Diamond 2",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:30:00.000Z",
        rank: "Radiant",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T12:00:00.000Z",
        createdAtUtc: "2026-01-17T10:40:00.000Z",
        rank: "Ascendant 3",
      },
    ];

    const result = computeBestParty(entries);

    // Highly imbalanced ranks should have high variance
    expect(result.rankBalanceScore).toBeGreaterThan(30);
  });
});

describe("computeBestParty - tiebreaking", () => {
  it("should prioritize earlier responders when meet times are equal", () => {
    const entries: Entry[] = [
      {
        userId: "userA",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "userB",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T21:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "userC",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:10:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "userD",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:20:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "userE",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:30:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "userF",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:40:00.000Z",
        rank: "Gold 2",
      },
    ];

    const result = computeBestParty(entries);

    // userB should be excluded (21:00 is the latest createdAt)
    // All other users have 20:00-20:40 createdAt
    expect(result.memberIds).toHaveLength(5);
    expect(result.memberIds).toContain("userA");
    expect(result.memberIds).not.toContain("userB"); // userB has the latest createdAt
  });

  it("should use rank variance as tiebreaker for equal meetTime and createdAt", () => {
    const entries: Entry[] = [
      {
        userId: "user1",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user2",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Gold 2",
      },
      {
        userId: "user3",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Gold 3",
      },
      {
        userId: "user4",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Gold 1",
      },
      {
        userId: "user5",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Radiant",
      },
      {
        userId: "user6",
        availableFromUtc: "2026-01-17T22:00:00.000Z",
        createdAtUtc: "2026-01-17T20:00:00.000Z",
        rank: "Radiant",
      },
    ];

    const result = computeBestParty(entries);

    // With 6 entries, should select 5 with lowest rank variance
    // Gold 2, Gold 2, Gold 3, Gold 1, Radiant -> exclude one Radiant (lower variance without second Radiant)
    // Results are sorted, so user6 should be excluded
    expect(result.memberIds).toHaveLength(5);
    expect(result.memberIds).not.toContain("user6"); // Excluded for higher rank variance
  });
});
