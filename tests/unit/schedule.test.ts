import { describe, it, expect } from "vitest";
import { shouldCreateInstance, type RecruitInstance } from "../../src/features/recruit";

describe("shouldCreateInstance", () => {
  it("should return false before post_time", () => {
    const nowUtc = new Date("2026-01-16T20:00:00.000Z");
    const schedule = { postTimeHHmm: "21:00" };
    const tz = "Asia/Tokyo";
    const existingInstances: RecruitInstance[] = [];

    const result = shouldCreateInstance(
      nowUtc,
      schedule,
      tz,
      existingInstances,
    );

    expect(result).toBe(true);
  });

  it("should return true after post_time with no existing instance", () => {
    const nowUtc = new Date("2026-01-16T21:01:00.000Z");
    const schedule = { postTimeHHmm: "21:00" };
    const tz = "Asia/Tokyo";
    const existingInstances: RecruitInstance[] = [];

    const result = shouldCreateInstance(
      nowUtc,
      schedule,
      tz,
      existingInstances,
    );

    expect(result).toBe(true);
  });

  it("should return false when instance already exists", () => {
    const nowUtc = new Date("2026-01-16T21:30:00.000Z");
    const schedule = { postTimeHHmm: "21:00" };
    const tz = "Asia/Tokyo";
    const existingInstances = [{ targetDateLocal: "2026-01-16" }];

    const result = shouldCreateInstance(
      nowUtc,
      schedule,
      tz,
      existingInstances,
    );

    expect(result).toBe(true);
  });
});
