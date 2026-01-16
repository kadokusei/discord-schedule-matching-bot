import { describe, it, expect } from "vitest";
import {
  diffMatch,
  formatNotification,
  matchSignature,
} from "../../src/features/recruit";

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
    expect(result.timeDiff).toEqual({ prev: "21:00", next: "22:00" });
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
    expect(result.timeDiff).toEqual({ prev: "21:00", next: "22:00" });
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

    expect(result).toBe(
      "【確定】@user1 @user2 @user3 @user4 @user5 集合 21:00",
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

    expect(result).toContain("メンバー変更: (前) @user5 → (今) @user6");
    expect(result).toContain("集合 21:00");
  });

  it("should format time change notification", () => {
    const diff = {
      type: "updated" as const,
      memberDiff: null,
      timeDiff: { prev: "21:00", next: "22:00" },
    };
    const match = {
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const result = formatNotification(diff, match, "Asia/Tokyo");

    expect(result).toContain("集合時刻: 21:00 → 22:00");
  });

  it("should format both changes notification", () => {
    const diff = {
      type: "updated" as const,
      memberDiff: { removed: ["user5"], added: ["user6"] },
      timeDiff: { prev: "21:00", next: "22:00" },
    };
    const match = {
      memberIds: ["user1", "user2", "user3", "user4", "user6"],
      meetTimeUtc: "2026-01-16T22:00:00.000Z",
    };

    const result = formatNotification(diff, match, "Asia/Tokyo");

    expect(result).toContain("メンバー変更: (前) @user5 → (今) @user6");
    expect(result).toContain("集合 21:00→22:00");
  });

  it("should format cancelled notification", () => {
    const diff = {
      type: "cancelled" as const,
      memberDiff: null,
      timeDiff: null,
    };

    const result = formatNotification(diff, null, "Asia/Tokyo");

    expect(result).toBe("【取消】確定条件（5人）未満になりました。");
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
