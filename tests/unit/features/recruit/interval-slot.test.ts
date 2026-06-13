import { describe, expect, it } from "vitest";
import { currentIntervalSlotUtc } from "../../../../src/features/recruit";

// JST 21:00 投稿、30分間隔、60分間 → スロットは 21:00 / 21:30 / 22:00 JST
// = UTC 12:00 / 12:30 / 13:00
describe("currentIntervalSlotUtc", () => {
  const tz = "Asia/Tokyo";
  const recruit = { targetDateLocal: "2026-01-16" };
  const schedule = { postTimeHHmm: "21:00", intervalMin: 30, durationMin: 60 };

  it("最初のスロット前は null", () => {
    const now = new Date("2026-01-16T11:00:00.000Z");
    expect(currentIntervalSlotUtc(recruit, schedule, tz, now)).toBeNull();
  });

  it("最初のスロット丁度はそのスロットを返す", () => {
    const now = new Date("2026-01-16T12:00:00.000Z");
    expect(currentIntervalSlotUtc(recruit, schedule, tz, now)).toBe("2026-01-16T12:00:00.000Z");
  });

  it("スロット間は直近の過去スロットを返す", () => {
    const now = new Date("2026-01-16T12:15:00.000Z");
    expect(currentIntervalSlotUtc(recruit, schedule, tz, now)).toBe("2026-01-16T12:00:00.000Z");

    const now2 = new Date("2026-01-16T12:45:00.000Z");
    expect(currentIntervalSlotUtc(recruit, schedule, tz, now2)).toBe("2026-01-16T12:30:00.000Z");
  });

  it("最終スロット丁度はそのスロットを返す", () => {
    const now = new Date("2026-01-16T13:00:00.000Z");
    expect(currentIntervalSlotUtc(recruit, schedule, tz, now)).toBe("2026-01-16T13:00:00.000Z");
  });

  it("最終スロットを過ぎたら null（募集枠終了）", () => {
    const now = new Date("2026-01-16T13:30:00.000Z");
    expect(currentIntervalSlotUtc(recruit, schedule, tz, now)).toBeNull();
  });
});
