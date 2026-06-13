import { describe, it, expect } from "vitest";
import {
  diffMatch,
  formatNotification,
  matchSignature,
  mentionTargets,
} from "../../../../src/features/recruit";
import type { Diff, Match } from "../../../../src/features/recruit";

describe("diffMatch", () => {
  it("should detect created when no previous match", () => {
    const prev = null;
    const next = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };

    const result = diffMatch(prev, next);

    expect(result.type).toBe("created");
    expect(result.memberDiff).toBeNull();
    expect(result.timeDiff).toBeNull();
  });

  it("should detect member change", () => {
    const prev = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const next = {
      memberIds: ["user1", "user2", "user3", "user4", "user6"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };

    const result = diffMatch(prev, next);

    expect(result.type).toBe("updated");
    expect(result.memberDiff).toEqual({ removed: ["user5"], added: ["user6"] });
    expect(result.timeDiff).toBeNull();
  });

  it("should detect time change", () => {
    const prev = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const next = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const result = diffMatch(prev, next);

    expect(result.type).toBe("updated");
    expect(result.memberDiff).toBeNull();
    expect(result.timeDiff).toEqual({
      prevUtc: "2026-01-16T21:00:00.000Z",
      nextUtc: "2026-01-16T22:00:00.000Z",
    });
  });

  it("should detect both member and time change", () => {
    const prev = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const next = {
      memberIds: ["user1", "user2", "user3", "user4", "user6"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const result = diffMatch(prev, next);

    expect(result.type).toBe("updated");
    expect(result.memberDiff).toEqual({ removed: ["user5"], added: ["user6"] });
    expect(result.timeDiff).toEqual({
      prevUtc: "2026-01-16T21:00:00.000Z",
      nextUtc: "2026-01-16T22:00:00.000Z",
    });
  });

  it("should detect cancelled when no next match", () => {
    const prev = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const next = null;

    const result = diffMatch(prev, next);

    expect(result.type).toBe("cancelled");
    expect(result.memberDiff).toBeNull();
    expect(result.timeDiff).toBeNull();
  });

  it("should detect no change when same", () => {
    const prev = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const next = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };

    const result = diffMatch(prev, next);

    expect(result.type).toBe("unchanged");
    expect(result.memberDiff).toBeNull();
    expect(result.timeDiff).toBeNull();
  });
});

describe("formatNotification", () => {
  it("should format created notification", () => {
    const diff = {
      type: "created" as const,
      memberDiff: null,
      timeDiff: null,
    };
    const match = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };

    const result = formatNotification(diff, match, "Asia/Tokyo");

    // 21:00Z は Asia/Tokyo では翌 06:00、メンバーは実メンション(<@id>)
    expect(result).toBe(
      "【確定】\n🕘 集合時刻: 06:00\n👥 メンバー: <@user1> <@user2> <@user3> <@user4> <@user5>",
    );
  });

  it("should format member change notification", () => {
    const diff = {
      type: "updated" as const,
      memberDiff: { removed: ["user5"], added: ["user6"] },
      timeDiff: null,
    };
    const match = {
      memberIds: ["user1", "user2", "user3", "user4", "user6"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };

    const result = formatNotification(diff, match, "Asia/Tokyo");

    // 21:00Z → JST 06:00
    expect(result).toContain("👥 メンバー変更: (前) <@user5> → (今) <@user6>");
    expect(result).toContain("🕘 集合時刻: 06:00");
  });

  it("should format time change notification", () => {
    const diff = {
      type: "updated" as const,
      memberDiff: null,
      timeDiff: {
        prevUtc: "2026-01-16T21:00:00.000Z",
        nextUtc: "2026-01-16T22:00:00.000Z",
      },
    };
    const match = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const result = formatNotification(diff, match, "Asia/Tokyo");

    // 21:00Z→06:00 / 22:00Z→07:00 (JST)
    expect(result).toContain("🕘 集合時刻: 06:00 → 07:00");
  });

  it("should format both changes notification", () => {
    const diff = {
      type: "updated" as const,
      memberDiff: { removed: ["user5"], added: ["user6"] },
      timeDiff: {
        prevUtc: "2026-01-16T21:00:00.000Z",
        nextUtc: "2026-01-16T22:00:00.000Z",
      },
    };
    const match = {
      memberIds: ["user1", "user2", "user3", "user4", "user6"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const result = formatNotification(diff, match, "Asia/Tokyo");

    expect(result).toContain("👥 メンバー変更: (前) <@user5> → (今) <@user6>");
    expect(result).toContain("🕘 集合時刻: 06:00 → 07:00");
  });

  it("should format cancelled notification", () => {
    const diff = {
      type: "cancelled" as const,
      memberDiff: null,
      timeDiff: null,
    };

    const result = formatNotification(diff, null, "Asia/Tokyo");

    expect(result).toBe("【取消】\n確定条件（5人）未満になりました。");
  });
});

describe("mentionTargets", () => {
  const members = ["user1", "user2", "user3", "user4", "user5"];
  const nextMatch: Match = { memberIds: members, meetTimeUtc: "2026-01-16T21:00:00.000Z" };
  const prevMatch: Match = { memberIds: members, meetTimeUtc: "2026-01-16T21:00:00.000Z" };

  it("should return all next members for created (no trigger exclusion)", () => {
    const diff: Diff = { type: "created", memberDiff: null, timeDiff: null };

    expect(mentionTargets(diff, null, nextMatch, "user1")).toEqual(members);
  });

  it("should return all next members for updated (no trigger exclusion)", () => {
    const diff: Diff = { type: "updated", memberDiff: null, timeDiff: null };

    expect(mentionTargets(diff, prevMatch, nextMatch, "user1")).toEqual(members);
  });

  it("should exclude the trigger from prev members for cancelled", () => {
    const diff: Diff = { type: "cancelled", memberDiff: null, timeDiff: null };

    expect(mentionTargets(diff, prevMatch, null, "user3")).toEqual([
      "user1",
      "user2",
      "user4",
      "user5",
    ]);
  });

  it("should return all prev members for cancelled when no trigger", () => {
    const diff: Diff = { type: "cancelled", memberDiff: null, timeDiff: null };

    expect(mentionTargets(diff, prevMatch, null)).toEqual(members);
  });

  it("should return empty array for unchanged", () => {
    const diff: Diff = { type: "unchanged", memberDiff: null, timeDiff: null };

    expect(mentionTargets(diff, prevMatch, nextMatch, "user1")).toEqual([]);
  });
});

describe("matchSignature", () => {
  it("should generate consistent signature", () => {
    const match1 = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const match2 = {
      memberIds: ["user5", "user4", "user3", "user2", "user1"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };

    const sig1 = matchSignature(match1);
    const sig2 = matchSignature(match2);

    expect(sig1).toBe(sig2);
  });

  it("should generate different signature for different matches", () => {
    const match1 = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T21:00:00.000Z",
    };
    const match2 = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const sig1 = matchSignature(match1);
    const sig2 = matchSignature(match2);

    expect(sig1).not.toBe(sig2);
  });
});
