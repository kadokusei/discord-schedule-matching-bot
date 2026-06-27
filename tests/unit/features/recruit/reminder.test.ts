import { describe, it, expect } from "vitest";
import { buildUndecidedNudge, shouldRemindUndecided } from "../../../../src/features/recruit";

describe("buildUndecidedNudge", () => {
  it("人数が揃ったので時間決定を促す文言を返す", () => {
    const message = buildUndecidedNudge();
    expect(message).toContain("希望時間");
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("shouldRemindUndecided", () => {
  const now = new Date("2026-06-27T12:00:00.000Z");

  it("初回(lastRemindedAtUtc===null)は即時リマインド要", () => {
    expect(shouldRemindUndecided(null, now, 60)).toBe(true);
  });

  it("間隔内(前回から intervalMin 未満)は再送しない", () => {
    const last = new Date(now.getTime() - 5 * 60_000).toISOString(); // 5分前
    expect(shouldRemindUndecided(last, now, 60)).toBe(false);
  });

  it("間隔経過後(前回から intervalMin 以上)は再送する", () => {
    const last = new Date(now.getTime() - 90 * 60_000).toISOString(); // 90分前
    expect(shouldRemindUndecided(last, now, 60)).toBe(true);
  });

  it("境界: 前回からちょうど intervalMin 経過なら再送する", () => {
    const last = new Date(now.getTime() - 60 * 60_000).toISOString(); // ちょうど60分前
    expect(shouldRemindUndecided(last, now, 60)).toBe(true);
  });

  it("intervalMin=0 のとき、未リマインド(null)以外なら常に再送する", () => {
    const last = new Date(now.getTime() - 1_000).toISOString(); // 1秒前
    expect(shouldRemindUndecided(last, now, 0)).toBe(true);
    expect(shouldRemindUndecided(null, now, 0)).toBe(true);
  });
});
