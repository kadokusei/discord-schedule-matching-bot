import { describe, it, expect } from "vitest";
import {
  regionSchema,
  timezoneSchema,
  riotAccountAddOptionsSchema,
  riotAccountRemoveOptionsSchema,
  recruitOptionsSchema,
} from "../../src/utils/validation";

describe("validation", () => {
  describe("regionSchema", () => {
    it("valid regions", () => {
      expect(regionSchema.parse("na")).toBe("na");
      expect(regionSchema.parse("eu")).toBe("eu");
      expect(regionSchema.parse("ap")).toBe("ap");
      expect(regionSchema.parse("kr")).toBe("kr");
      expect(regionSchema.parse("latam")).toBe("latam");
      expect(regionSchema.parse("br")).toBe("br");
    });

    it("invalid region", () => {
      expect(() => regionSchema.parse("invalid")).toThrow();
    });
  });

  describe("timezoneSchema", () => {
    it("valid timezones", () => {
      expect(timezoneSchema.parse("Asia/Tokyo")).toBe("Asia/Tokyo");
      expect(timezoneSchema.parse("America/New_York")).toBe("America/New_York");
      expect(timezoneSchema.parse("Europe/London")).toBe("Europe/London");
      expect(timezoneSchema.parse("UTC")).toBe("UTC");
    });

    it("invalid timezone", () => {
      expect(() => timezoneSchema.parse("Invalid/Timezone")).toThrow();
      expect(() => timezoneSchema.parse("NotATimezone")).toThrow();
    });
  });

  describe("riotAccountAddOptionsSchema", () => {
    it("valid options", () => {
      const result = riotAccountAddOptionsSchema.parse({
        game_name: "TestPlayer",
        tag_line: "123",
        region: "na",
      });
      expect(result).toEqual({
        game_name: "TestPlayer",
        tag_line: "123",
        region: "na",
      });
    });

    it("default region", () => {
      const result = riotAccountAddOptionsSchema.parse({
        game_name: "TestPlayer",
        tag_line: "123",
      });
      expect(result.region).toBe("na");
    });

    it("missing required fields", () => {
      const result = riotAccountAddOptionsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("invalid region", () => {
      const result = riotAccountAddOptionsSchema.safeParse({
        game_name: "TestPlayer",
        tag_line: "123",
        region: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("riotAccountRemoveOptionsSchema", () => {
    it("both fields provided", () => {
      const result = riotAccountRemoveOptionsSchema.parse({
        game_name: "TestPlayer",
        tag_line: "123",
      });
      expect(result).toEqual({
        game_name: "TestPlayer",
        tag_line: "123",
      });
    });

    it("both fields omitted", () => {
      const result = riotAccountRemoveOptionsSchema.parse({});
      expect(result).toEqual({
        game_name: undefined,
        tag_line: undefined,
      });
    });

    it("only game_name provided - should fail", () => {
      const result = riotAccountRemoveOptionsSchema.safeParse({
        game_name: "TestPlayer",
      });
      expect(result.success).toBe(false);
    });

    it("only tag_line provided - should fail", () => {
      const result = riotAccountRemoveOptionsSchema.safeParse({
        tag_line: "123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("recruitOptionsSchema", () => {
    it("valid time format", () => {
      const result = recruitOptionsSchema.parse({
        post_time: "20:00",
        interval: "30",
        duration: "360",
      });
      expect(result.post_time).toBe("20:00");
      expect(result.interval).toBe(30);
      expect(result.duration).toBe(360);
    });

    it("valid time format without optional fields", () => {
      const result = recruitOptionsSchema.parse({
        post_time: "09:30",
      });
      expect(result.post_time).toBe("09:30");
      expect(result.interval).toBeUndefined();
      expect(result.duration).toBeUndefined();
    });

    it("invalid time format - missing colon", () => {
      const result = recruitOptionsSchema.safeParse({
        post_time: "2000",
      });
      expect(result.success).toBe(false);
    });

    it("invalid time format - single digit", () => {
      const result = recruitOptionsSchema.safeParse({
        post_time: "9:00",
      });
      expect(result.success).toBe(false);
    });

    it("invalid interval - negative number", () => {
      const result = recruitOptionsSchema.safeParse({
        post_time: "20:00",
        interval: "-10",
      });
      expect(result.success).toBe(false);
    });

    it("invalid interval - not a number", () => {
      const result = recruitOptionsSchema.safeParse({
        post_time: "20:00",
        interval: "abc",
      });
      expect(result.success).toBe(false);
    });
  });
});
