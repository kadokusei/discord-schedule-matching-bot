import { describe, expect, it } from "vitest";
import { type RecruitInstance, shouldCreateInstance } from "../../../../src/features/recruit";

describe("shouldCreateInstance", () => {
  it("should return true when current time is before post_time", () => {
    // JST 12:00 (UTC 03:00) < JST 21:00 (post_time)
    const nowUtc = new Date("2026-01-16T03:00:00.000Z");
    const schedule = { postTimeHHmm: "21:00" };
    const tz = "Asia/Tokyo";
    const existingInstances: RecruitInstance[] = [];

    const result = shouldCreateInstance(nowUtc, schedule, tz, existingInstances);

    expect(result).toBe(true);
  });

  it("should return true when time has passed and no instance exists", () => {
    // JST 06:00 (UTC 21:01 of previous day) > JST 21:00 (post_time of previous day)
    const nowUtc = new Date("2026-01-16T21:01:00.000Z");
    const schedule = { postTimeHHmm: "21:00" };
    const tz = "Asia/Tokyo";
    const existingInstances: RecruitInstance[] = [];

    const result = shouldCreateInstance(nowUtc, schedule, tz, existingInstances);

    expect(result).toBe(true);
  });

  it("should return false when instance for same date already exists", () => {
    const nowUtc = new Date("2026-01-16T12:30:00.000Z");
    const schedule = { postTimeHHmm: "21:00" };
    const tz = "Asia/Tokyo";
    const existingInstances = [{ targetDateLocal: "2026-01-16" }];

    const result = shouldCreateInstance(nowUtc, schedule, tz, existingInstances);

    expect(result).toBe(false);
  });
});
