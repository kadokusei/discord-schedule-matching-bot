import { describe, it, expect } from "vitest";
import {
  reminderSlotToSend,
  buildReminderMessage,
  buildUndecidedNudge,
  type ReminderSlotParams,
} from "../../../../src/features/recruit";

const TZ = "Asia/Tokyo";

// 募集開始 20:00 JST = 11:00 UTC、interval 15 分、duration 360 分（25 スロット）
// スロット: 11:00Z(20:00), 11:15Z(20:15), 11:30Z(20:30), 11:45Z(20:45), ...
const baseParams = (overrides: Partial<ReminderSlotParams> = {}): ReminderSlotParams => ({
  targetDateLocal: "2026-01-17",
  postTimeHHmm: "20:00",
  intervalMin: 15,
  durationMin: 360,
  createdAtUtc: "2026-01-17T11:13:00.000Z", // 20:13 JST 登録
  lastRemindedAtUtc: null,
  ...overrides,
});

describe("reminderSlotToSend", () => {
  it("登録直後スロット(20:15)をスキップし、2番目のスロット(20:30)で初回送信する", () => {
    const result = reminderSlotToSend(baseParams(), TZ, new Date("2026-01-17T11:30:00.000Z"));
    expect(result).toBe("2026-01-17T11:30:00.000Z");
  });

  it("初回対象スロット(20:30)未到来なら null（20:15 時点では送らない）", () => {
    const result = reminderSlotToSend(baseParams(), TZ, new Date("2026-01-17T11:20:00.000Z"));
    expect(result).toBeNull();
  });

  it("同一スロットで送信済み(lastRemindedAtUtc === currentSlot)なら null", () => {
    const result = reminderSlotToSend(
      baseParams({ lastRemindedAtUtc: "2026-01-17T11:30:00.000Z" }),
      TZ,
      new Date("2026-01-17T11:33:00.000Z"),
    );
    expect(result).toBeNull();
  });

  it("次のスロット(20:45)が到来したら次のスロット時刻を返す", () => {
    const result = reminderSlotToSend(
      baseParams({ lastRemindedAtUtc: "2026-01-17T11:30:00.000Z" }),
      TZ,
      new Date("2026-01-17T11:45:00.000Z"),
    );
    expect(result).toBe("2026-01-17T11:45:00.000Z");
  });

  it("募集開始前は null（最初のスロット未到来）", () => {
    const result = reminderSlotToSend(
      baseParams({ createdAtUtc: "2026-01-17T10:50:00.000Z" }),
      TZ,
      new Date("2026-01-17T10:55:00.000Z"),
    );
    expect(result).toBeNull();
  });

  it("最終スロットを過ぎたら null", () => {
    // 最終スロット = 11:00Z + 360min = 17:00Z（翌2:00 JST）
    const result = reminderSlotToSend(baseParams(), TZ, new Date("2026-01-17T17:30:00.000Z"));
    expect(result).toBeNull();
  });

  it("登録が終盤で 2 番目スロットが存在しない場合は null", () => {
    // 最終スロット 17:00Z の直前に登録 → slotsAfterJoin = [17:00Z] のみ、[1] が無い
    const result = reminderSlotToSend(
      baseParams({ createdAtUtc: "2026-01-17T16:50:00.000Z" }),
      TZ,
      new Date("2026-01-17T17:00:00.000Z"),
    );
    expect(result).toBeNull();
  });
});

describe("buildReminderMessage", () => {
  it("希望時間の登録を促す文言を返す", () => {
    const message = buildReminderMessage("recruit-123");
    expect(message).toContain("希望時間");
    expect(message).toContain("セレクトメニュー");
  });
});

describe("buildUndecidedNudge", () => {
  it("人数が揃ったので時間決定を促す文言を返す", () => {
    const message = buildUndecidedNudge();
    expect(message).toContain("希望時間");
    expect(message.length).toBeGreaterThan(0);
  });
});
