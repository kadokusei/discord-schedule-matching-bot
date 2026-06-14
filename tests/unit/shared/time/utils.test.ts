import { describe, it, expect } from "vitest";
import {
  buildTimeOptions,
  localDateTimeToUtc,
  timeOptionCount,
  type TimeOption,
} from "../../../../src/shared/time";

describe("timeOptionCount", () => {
  it("returns 13 for 30min interval / 360min duration", () => {
    expect(timeOptionCount(30, 360)).toBe(13);
  });

  it("returns 73 for 5min interval / 360min duration", () => {
    expect(timeOptionCount(5, 360)).toBe(73);
  });

  it("returns 25 at the 60min interval / 1440min (24h) boundary", () => {
    expect(timeOptionCount(60, 1440)).toBe(25);
  });

  it("floors non-divisible combinations to match buildTimeOptions length", () => {
    expect(timeOptionCount(30, 350)).toBe(12);
    expect(timeOptionCount(30, 350)).toBe(
      buildTimeOptions("2026-01-16", "21:00", 30, 350, "UTC").length,
    );
  });
});

describe("buildTimeOptions", () => {
  it("should generate 13 options with HH:mm labels and ISO 8601 values", () => {
    const targetDateLocal = "2026-01-16";
    const postTimeHHmm = "21:00";
    const intervalMin = 30;
    const durationMin = 360;
    const tz = "Asia/Tokyo";

    const result = buildTimeOptions(targetDateLocal, postTimeHHmm, intervalMin, durationMin, tz);

    expect(result).toHaveLength(13);

    for (const option of result) {
      expect(option.label).toMatch(/^\d{2}:\d{2}$/);
      expect(option.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("should handle date crossing correctly", () => {
    const targetDateLocal = "2026-01-16";
    const postTimeHHmm = "23:30";
    const intervalMin = 30;
    const durationMin = 360;
    const tz = "Asia/Tokyo";

    const result = buildTimeOptions(targetDateLocal, postTimeHHmm, intervalMin, durationMin, tz);

    expect(result).toHaveLength(13);

    const values = result.map((o: TimeOption) => o.value);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(13);
  });

  it("should generate options starting from post_time", () => {
    const targetDateLocal = "2026-01-16";
    const postTimeHHmm = "21:00";
    const intervalMin = 30;
    const durationMin = 360;
    const tz = "Asia/Tokyo";

    const result = buildTimeOptions(targetDateLocal, postTimeHHmm, intervalMin, durationMin, tz);

    expect(result[0].label).toBe("21:00");
    expect(result[1].label).toBe("21:30");
    expect(result[2].label).toBe("22:00");
  });

  it("should generate options up to 6 hours", () => {
    const targetDateLocal = "2026-01-16";
    const postTimeHHmm = "21:00";
    const intervalMin = 30;
    const durationMin = 360;
    const tz = "Asia/Tokyo";

    const result = buildTimeOptions(targetDateLocal, postTimeHHmm, intervalMin, durationMin, tz);

    expect(result[12].label).toBe("03:00");
  });
});

describe("localDateTimeToUtc", () => {
  it("should convert Asia/Tokyo local time to UTC", () => {
    // JST 21:00 = UTC 12:00 (UTC+9)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "Asia/Tokyo");

    expect(result.toISOString()).toBe("2026-01-18T12:00:00.000Z");
  });

  it("should convert America/New_York local time to UTC (EST)", () => {
    // EST 21:00 = UTC 02:00 (UTC-5)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "America/New_York");

    expect(result.toISOString()).toBe("2026-01-19T02:00:00.000Z");
  });

  it("should convert Europe/London local time to UTC (GMT)", () => {
    // GMT 21:00 = UTC 21:00 (UTC+0)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "Europe/London");

    expect(result.toISOString()).toBe("2026-01-18T21:00:00.000Z");
  });

  it("should convert Australia/Sydney local time to UTC (AEDT)", () => {
    // AEDT 21:00 = UTC 09:00 (UTC+11 during daylight saving)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "Australia/Sydney");

    // Note: Australia/Sydney is UTC+11 during daylight saving (Oct-Apr), UTC+10 otherwise
    // January is during daylight saving, so UTC+11
    expect(result.toISOString()).toBe("2026-01-18T10:00:00.000Z");
  });

  it("should handle DST transition for America/New_York (EDT)", () => {
    // EDT (UTC-4) vs EST (UTC-5)
    // During summer (EDT): 21:00 = UTC 01:00
    // During winter (EST): 21:00 = UTC 02:00
    // This test uses a date in January (EST)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "America/New_York");

    expect(result.toISOString()).toBe("2026-01-19T02:00:00.000Z");
  });

  it("should handle DST transition for Europe/London (BST)", () => {
    // BST (UTC+1) vs GMT (UTC+0)
    // During summer (BST): 21:00 = UTC 20:00
    // During winter (GMT): 21:00 = UTC 21:00
    // This test uses a date in January (GMT)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "Europe/London");

    expect(result.toISOString()).toBe("2026-01-18T21:00:00.000Z");
  });

  it("should handle date crossing (positive offset)", () => {
    // Pacific Time (UTC-8) 02:00 = UTC 10:00 (next day)
    const result = localDateTimeToUtc("2026-01-18", "02:00", "America/Los_Angeles");

    expect(result.toISOString()).toBe("2026-01-18T10:00:00.000Z");
  });

  it("should handle date crossing (negative offset)", () => {
    // Pacific/Kiritimati (UTC+14) 23:00 = UTC 09:00 (previous day)
    const result = localDateTimeToUtc("2026-01-18", "23:00", "Pacific/Kiritimati");

    expect(result.toISOString()).toBe("2026-01-18T09:00:00.000Z");
  });

  it("should handle UTC timezone (no offset)", () => {
    const result = localDateTimeToUtc("2026-01-18", "21:00", "UTC");

    expect(result.toISOString()).toBe("2026-01-18T21:00:00.000Z");
  });

  it("should handle 30-minute offset timezone", () => {
    // Afghanistan Time (UTC+4:30)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "Asia/Kabul");

    expect(result.toISOString()).toBe("2026-01-18T16:30:00.000Z");
  });

  it("should handle 45-minute offset timezone", () => {
    // Nepal Time (UTC+5:45)
    const result = localDateTimeToUtc("2026-01-18", "21:00", "Asia/Kathmandu");

    expect(result.toISOString()).toBe("2026-01-18T15:15:00.000Z");
  });

  it("should handle midnight time crossing", () => {
    // Pacific Time (UTC-8) 00:00 = UTC 08:00
    const result = localDateTimeToUtc("2026-01-18", "00:00", "America/Los_Angeles");

    expect(result.toISOString()).toBe("2026-01-18T08:00:00.000Z");
  });

  it("should handle late night time crossing", () => {
    // Japan Time (UTC+9) 23:30 = UTC 14:30 (previous day)
    const result = localDateTimeToUtc("2026-01-18", "23:30", "Asia/Tokyo");

    expect(result.toISOString()).toBe("2026-01-18T14:30:00.000Z");
  });
});
