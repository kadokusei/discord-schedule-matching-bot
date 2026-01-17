import { describe, it, expect } from "vitest";
import { buildTimeOptions, type TimeOption } from "../../../../src/shared/time";

describe("buildTimeOptions", () => {
  it("should generate 13 options with HH:mm labels and ISO 8601 values", () => {
    const targetDateLocal = "2026-01-16";
    const postTimeHHmm = "21:00";
    const intervalMin = 30;
    const durationMin = 360;
    const tz = "Asia/Tokyo";

    const result = buildTimeOptions(
      targetDateLocal,
      postTimeHHmm,
      intervalMin,
      durationMin,
      tz,
    );

    expect(result).toHaveLength(13);

    for (const option of result) {
      expect(option.label).toMatch(/^\d{2}:\d{2}$/);
      expect(option.value).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
  });

  it("should handle date crossing correctly", () => {
    const targetDateLocal = "2026-01-16";
    const postTimeHHmm = "23:30";
    const intervalMin = 30;
    const durationMin = 360;
    const tz = "Asia/Tokyo";

    const result = buildTimeOptions(
      targetDateLocal,
      postTimeHHmm,
      intervalMin,
      durationMin,
      tz,
    );

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

    const result = buildTimeOptions(
      targetDateLocal,
      postTimeHHmm,
      intervalMin,
      durationMin,
      tz,
    );

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

    const result = buildTimeOptions(
      targetDateLocal,
      postTimeHHmm,
      intervalMin,
      durationMin,
      tz,
    );

    expect(result[12].label).toBe("03:00");
  });
});
