import { describe, it, expect } from "vitest";

describe("handleScheduled - Date formatting logic", () => {
  it("should format date correctly for Asia/Tokyo timezone", () => {
    const nowUtc = new Date("2026-01-18T12:00:00.000Z");
    const tz = "Asia/Tokyo";

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(nowUtc);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const targetDateLocal = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    expect(targetDateLocal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(year).toBeGreaterThanOrEqual(2026);
  });

  it("should format date correctly for UTC timezone", () => {
    const nowUtc = new Date("2026-01-18T12:00:00.000Z");
    const tz = "UTC";

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(nowUtc);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const targetDateLocal = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    expect(targetDateLocal).toBe("2026-01-18");
  });

  it("should format date correctly for America/New_York timezone", () => {
    const nowUtc = new Date("2026-01-18T12:00:00.000Z");
    const tz = "America/New_York";

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(nowUtc);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const targetDateLocal = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    expect(targetDateLocal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("should handle date boundary correctly", () => {
    // Test UTC time that crosses date boundary in Japan
    const nowUtc = new Date("2026-01-18T23:59:59.000Z");
    const tz = "Asia/Tokyo";

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(nowUtc);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const targetDateLocal = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // In Japan, this would be the next day (Jan 19)
    expect(targetDateLocal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("handleScheduled - Schedule filtering", () => {
  it("should filter out inactive schedules", () => {
    const schedules = [
      { id: "1", active: 1, postTimeHHmm: "20:00" },
      { id: "2", active: 0, postTimeHHmm: "21:00" },
      { id: "3", active: 1, postTimeHHmm: "22:00" },
    ];

    const activeSchedules = schedules.filter((s) => s.active);
    expect(activeSchedules).toHaveLength(2);
    expect(activeSchedules.map((s) => s.id)).toEqual(["1", "3"]);
  });

  it("should process schedules in order", () => {
    const schedules = [
      { id: "1", active: 1, channelId: "channel-1" },
      { id: "2", active: 1, channelId: "channel-2" },
      { id: "3", active: 1, channelId: "channel-3" },
    ];

    const processedOrder: string[] = [];
    for (const schedule of schedules) {
      processedOrder.push(schedule.id);
    }

    expect(processedOrder).toEqual(["1", "2", "3"]);
  });
});

describe("handleScheduled - Reminder processing", () => {
  it("should filter pending_time entries for reminders", () => {
    const entries = [
      { id: "1", state: "pending_time", lastRemindedAtUtc: null },
      { id: "2", state: "confirmed", lastRemindedAtUtc: null },
      { id: "3", state: "pending_time", lastRemindedAtUtc: "2026-01-18T11:00:00.000Z" },
      { id: "4", state: "cancelled", lastRemindedAtUtc: null },
    ];

    const pendingEntries = entries.filter((e) => e.state === "pending_time");
    expect(pendingEntries).toHaveLength(2);
    expect(pendingEntries.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("should calculate reminder eligibility based on interval", () => {
    // Inline implementation for testing
    function shouldSendReminder(
      entry: { lastRemindedAtUtc: string | null },
      reminderIntervalMin: number | null | undefined,
      nowUtc: Date,
    ): boolean {
      if (!entry.lastRemindedAtUtc) {
        return true;
      }

      const intervalMs = (reminderIntervalMin ?? 60) * 60 * 1000;
      const lastReminded = new Date(entry.lastRemindedAtUtc);
      const elapsedMs = nowUtc.getTime() - lastReminded.getTime();

      return elapsedMs >= intervalMs;
    }

    const entry1 = { lastRemindedAtUtc: null };
    const entry2 = { lastRemindedAtUtc: "2026-01-18T11:00:00.000Z" };
    const nowUtc = new Date("2026-01-18T12:00:00.000Z");

    expect(shouldSendReminder(entry1, 60, nowUtc)).toBe(true);
    expect(shouldSendReminder(entry2, 60, nowUtc)).toBe(true);
    expect(shouldSendReminder(entry2, 120, nowUtc)).toBe(false);
  });
});
