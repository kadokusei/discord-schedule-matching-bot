import { describe, expect, it } from "vitest";
import { type RecruitInstance, shouldCreateInstance } from "../../../../src/features/recruit";

// post_time は「募集を投稿する時刻」。now >= post_time の最初の tick で当日分を1回だけ作成する。
describe("shouldCreateInstance", () => {
  const tz = "Asia/Tokyo";
  const schedule = { postTimeHHmm: "21:00" };

  it("should NOT create before post_time", () => {
    // JST 12:00 (UTC 03:00) < JST 21:00 (post_time) → 投稿時刻前なので作らない
    const nowUtc = new Date("2026-01-16T03:00:00.000Z");
    const existingInstances: RecruitInstance[] = [];

    expect(shouldCreateInstance(nowUtc, schedule, tz, existingInstances)).toBe(false);
  });

  it("should create exactly at post_time", () => {
    // JST 21:00 (UTC 12:00) === post_time → 作成する
    const nowUtc = new Date("2026-01-16T12:00:00.000Z");
    const existingInstances: RecruitInstance[] = [];

    expect(shouldCreateInstance(nowUtc, schedule, tz, existingInstances)).toBe(true);
  });

  it("should create after post_time when no instance exists", () => {
    // JST 21:05 (UTC 12:05) > post_time かつ当日分が未作成 → 作成する
    const nowUtc = new Date("2026-01-16T12:05:00.000Z");
    const existingInstances: RecruitInstance[] = [];

    expect(shouldCreateInstance(nowUtc, schedule, tz, existingInstances)).toBe(true);
  });

  it("should return false when instance for same date already exists", () => {
    // JST 21:30、当日分(2026-01-16)が既存 → 重複なので作らない
    const nowUtc = new Date("2026-01-16T12:30:00.000Z");
    const existingInstances = [{ targetDateLocal: "2026-01-16" }];

    expect(shouldCreateInstance(nowUtc, schedule, tz, existingInstances)).toBe(false);
  });
});
