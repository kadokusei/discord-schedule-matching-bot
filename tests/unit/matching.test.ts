import { describe, it, expect } from "vitest";
import { computeBestParty } from "../../src/utils/matching.js";

describe("computeBestParty", () => {
  it("should return all 5 members when exactly 5", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T21:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T21:30:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T23:00:00.000Z" },
    ];

    const result = computeBestParty(entries);

    expect(result.memberIds).toHaveLength(5);
    expect(result.meetTimeUtc).toBe("2026-01-16T23:00:00.000Z");
  });

  it("should select 5 members with earliest meet time when more than 5", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T21:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T21:30:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T23:00:00.000Z" },
      { userId: "user6", availableFromUtc: "2026-01-16T23:30:00.000Z" },
    ];

    const result = computeBestParty(entries);

    expect(result.memberIds).toHaveLength(5);
    expect(result.meetTimeUtc).toBe("2026-01-16T23:00:00.000Z");
  });

  it("should be stable on ties", () => {
    const entries = [
      { userId: "user1", availableFromUtc: "2026-01-16T21:00:00.000Z" },
      { userId: "user2", availableFromUtc: "2026-01-16T21:30:00.000Z" },
      { userId: "user3", availableFromUtc: "2026-01-16T22:00:00.000Z" },
      { userId: "user4", availableFromUtc: "2026-01-16T22:30:00.000Z" },
      { userId: "user5", availableFromUtc: "2026-01-16T23:00:00.000Z" },
      { userId: "user6", availableFromUtc: "2026-01-16T23:00:00.000Z" },
    ];

    const result1 = computeBestParty(entries);
    const result2 = computeBestParty(entries);

    expect(result1.memberIds).toEqual(result2.memberIds);
    expect(result1.meetTimeUtc).toBe(result2.meetTimeUtc);
  });
});
