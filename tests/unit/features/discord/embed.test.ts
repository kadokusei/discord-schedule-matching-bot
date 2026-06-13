import { describe, it, expect } from "vitest";
import { buildRecruitEmbed, type RecruitEmbedParams } from "../../../../src/features/discord/embed";

// Note: formatConfirmedUsers, formatPendingUsers, and getEmbedColor are private functions
// These tests verify the behavior through buildRecruitEmbed instead

describe("formatConfirmedUsers (via buildRecruitEmbed)", () => {
  it("should handle empty confirmed users", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "open",
      confirmedCount: 0,
      pendingCount: 0,
    };
    const result = buildRecruitEmbed(params);
    const statusField = result.embeds[0].fields?.find((f) => f.name === "参加状況");
    expect(statusField?.value).toContain("確定: 0人");
    expect(statusField?.value).not.toContain("<@");
  });

  it("should format users with timezone", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "open",
      confirmedCount: 2,
      pendingCount: 0,
      confirmedUsers: [
        { userId: "user1", availableFromUtc: "2026-01-18T12:00:00.000Z" },
        { userId: "user2", availableFromUtc: "2026-01-18T13:00:00.000Z" },
      ],
      timezone: "Asia/Tokyo",
    };
    const result = buildRecruitEmbed(params);
    const statusField = result.embeds[0].fields?.find((f) => f.name === "参加状況");
    expect(statusField?.value).toContain("<@user1>");
    expect(statusField?.value).toContain("<@user2>");
  });
});

describe("formatPendingUsers (via buildRecruitEmbed)", () => {
  it("should handle empty pending users", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "open",
      confirmedCount: 0,
      pendingCount: 0,
    };
    const result = buildRecruitEmbed(params);
    const statusField = result.embeds[0].fields?.find((f) => f.name === "参加状況");
    expect(statusField?.value).toContain("回答待ち: 0人");
  });

  it("should format pending users with waiting message", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "open",
      confirmedCount: 0,
      pendingCount: 2,
      pendingUserIds: ["user1", "user2"],
    };
    const result = buildRecruitEmbed(params);
    const statusField = result.embeds[0].fields?.find((f) => f.name === "参加状況");
    expect(statusField?.value).toContain("<@user1> (時間回答待ち)");
    expect(statusField?.value).toContain("<@user2> (時間回答待ち)");
  });
});

describe("getEmbedColor (via buildRecruitEmbed)", () => {
  it("should return green for open status", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "open",
      confirmedCount: 0,
      pendingCount: 0,
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].color).toBe(0x00ff00);
  });

  it("should return blue for matched status", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "matched",
      confirmedCount: 5,
      pendingCount: 0,
      matchedMembers: ["user1", "user2", "user3", "user4", "user5"],
      matchedTime: "21:00",
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].color).toBe(0x0000ff);
  });

  it("should return red for cancelled status", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "cancelled",
      confirmedCount: 0,
      pendingCount: 0,
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].color).toBe(0xff0000);
  });

  it("should return gray for deleted status", () => {
    const params: RecruitEmbedParams = {
      targetDateLocal: "2026-01-18",
      postTimeHHmm: "20:00",
      status: "deleted",
      confirmedCount: 0,
      pendingCount: 0,
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].color).toBe(0x808080);
  });
});

describe("buildRecruitEmbed", () => {
  const baseParams: RecruitEmbedParams = {
    targetDateLocal: "2026-01-18",
    postTimeHHmm: "20:00",
    status: "open",
    confirmedCount: 0,
    pendingCount: 0,
  };

  it("should build embed for open status", () => {
    const result = buildRecruitEmbed(baseParams);
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toBe("【募集】");
    expect(result.embeds[0].color).toBe(0x00ff00);
    expect(result.embeds[0].description).toContain("2026-01-18");
    expect(result.embeds[0].description).toContain("20:00");
  });

  it("should build embed for matched status", () => {
    const params: RecruitEmbedParams = {
      ...baseParams,
      status: "matched",
      confirmedCount: 5,
      pendingCount: 1,
      matchedMembers: ["user1", "user2", "user3", "user4", "user5"],
      matchedTime: "21:00",
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].title).toBe("【確定】");
    expect(result.embeds[0].color).toBe(0x0000ff);
    expect(result.embeds[0].fields).toBeDefined();
    expect(result.embeds[0].fields?.length).toBeGreaterThan(1);
  });

  it("should build embed for cancelled status", () => {
    const params: RecruitEmbedParams = {
      ...baseParams,
      status: "cancelled",
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].title).toBe("【募集】(取消)");
    expect(result.embeds[0].color).toBe(0xff0000);
  });

  it("should build embed for deleted status", () => {
    const params: RecruitEmbedParams = {
      ...baseParams,
      status: "deleted",
    };
    const result = buildRecruitEmbed(params);
    expect(result.embeds[0].title).toBe("【募集】(削除済み)");
    expect(result.embeds[0].color).toBe(0x808080);
  });

  it("should include confirmed users when provided", () => {
    const params: RecruitEmbedParams = {
      ...baseParams,
      confirmedCount: 2,
      confirmedUsers: [
        { userId: "user1", availableFromUtc: "2026-01-18T21:00:00.000Z" },
        { userId: "user2", availableFromUtc: "2026-01-18T21:30:00.000Z" },
      ],
    };
    const result = buildRecruitEmbed(params);
    const statusField = result.embeds[0].fields?.find((f) => f.name === "参加状況");
    expect(statusField?.value).toContain("<@user1>");
    expect(statusField?.value).toContain("<@user2>");
  });

  it("should include pending users when provided", () => {
    const params: RecruitEmbedParams = {
      ...baseParams,
      pendingCount: 2,
      pendingUserIds: ["user3", "user4"],
    };
    const result = buildRecruitEmbed(params);
    const statusField = result.embeds[0].fields?.find((f) => f.name === "参加状況");
    expect(statusField?.value).toContain("<@user3>");
    expect(statusField?.value).toContain("<@user4>");
  });

  it("should include matching result when matched", () => {
    const params: RecruitEmbedParams = {
      ...baseParams,
      status: "matched",
      matchedMembers: ["user1", "user2", "user3", "user4", "user5"],
      matchedTime: "21:00",
    };
    const result = buildRecruitEmbed(params);
    const matchField = result.embeds[0].fields?.find((f) => f.name === "マッチング結果");
    expect(matchField).toBeDefined();
    expect(matchField?.value).toContain("21:00");
    expect(matchField?.value).toContain("<@user1>");
  });

  it("should include timestamp", () => {
    const result = buildRecruitEmbed(baseParams);
    expect(result.embeds[0].timestamp).toBeDefined();
    expect(new Date(result.embeds[0].timestamp).toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });
});
