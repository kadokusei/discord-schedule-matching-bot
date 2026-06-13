import { describe, expect, it } from "vitest";
import { isRecruitExpired } from "../../../../src/features/recruit/expiry";

describe("isRecruitExpired", () => {
  it("should return false when current time is before expiry", () => {
    // 2026-01-15 20:00 JST + 360min = 2026-01-16 02:00 JST = 2026-01-15 17:00 UTC
    const result = isRecruitExpired(
      {
        targetDateLocal: "2026-01-15",
        postTimeHHmm: "20:00",
        durationMin: 360,
      },
      "Asia/Tokyo",
      new Date("2026-01-15T16:00:00Z"), // 2026-01-16 01:00 JST — before expiry
    );

    expect(result).toBe(false);
  });

  it("should return true when current time is after expiry", () => {
    // 2026-01-15 20:00 JST + 360min = 2026-01-16 02:00 JST = 2026-01-15 17:00 UTC
    const result = isRecruitExpired(
      {
        targetDateLocal: "2026-01-15",
        postTimeHHmm: "20:00",
        durationMin: 360,
      },
      "Asia/Tokyo",
      new Date("2026-01-15T18:00:00Z"), // 2026-01-16 03:00 JST — after expiry
    );

    expect(result).toBe(true);
  });

  it("should return true when current time equals expiry exactly", () => {
    const result = isRecruitExpired(
      {
        targetDateLocal: "2026-01-15",
        postTimeHHmm: "20:00",
        durationMin: 360,
      },
      "Asia/Tokyo",
      new Date("2026-01-15T17:00:00Z"), // exactly at expiry
    );

    expect(result).toBe(true);
  });

  it("should handle different timezones correctly", () => {
    // 2026-01-15 14:00 EST + 60min = 2026-01-15 15:00 EST = 2026-01-15 20:00 UTC
    const result = isRecruitExpired(
      {
        targetDateLocal: "2026-01-15",
        postTimeHHmm: "14:00",
        durationMin: 60,
      },
      "America/New_York",
      new Date("2026-01-15T20:30:00Z"), // after expiry
    );

    expect(result).toBe(true);
  });

  it("should handle short duration", () => {
    // 2026-01-15 20:00 JST + 30min = 2026-01-15 20:30 JST = 2026-01-15 11:30 UTC
    const result = isRecruitExpired(
      {
        targetDateLocal: "2026-01-15",
        postTimeHHmm: "20:00",
        durationMin: 30,
      },
      "Asia/Tokyo",
      new Date("2026-01-15T11:00:00Z"), // before expiry
    );

    expect(result).toBe(false);
  });
});
