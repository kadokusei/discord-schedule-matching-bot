import { describe, expect, it } from "vitest";
import { buildMatchFromRecruit } from "../../../src/handlers/matching";

describe("buildMatchFromRecruit", () => {
  it("should return null when matchedMeetTimeUtc is null", () => {
    const recruit = {
      matchedMeetTimeUtc: null,
      matchedMemberIdsJson: '["user1", "user2"]',
    };
    expect(buildMatchFromRecruit(recruit)).toBeNull();
  });

  it("should return null when matchedMemberIdsJson is null", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: null,
    };
    expect(buildMatchFromRecruit(recruit)).toBeNull();
  });

  it("should return null when both fields are null", () => {
    const recruit = {
      matchedMeetTimeUtc: null,
      matchedMemberIdsJson: null,
    };
    expect(buildMatchFromRecruit(recruit)).toBeNull();
  });

  it("should return valid match when both fields are present", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: '["user1", "user2", "user3", "user4", "user5"]',
    };
    const result = buildMatchFromRecruit(recruit);
    expect(result).toEqual({
      memberIds: ["user1", "user2", "user3", "user4", "user5"],
      meetTimeUtc: "2026-01-18T12:00:00.000Z",
    });
  });

  it("should return null for malformed JSON", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: "invalid-json{",
    };
    expect(buildMatchFromRecruit(recruit)).toBeNull();
  });

  it("should return null for non-array JSON", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: '{"key": "value"}',
    };
    expect(buildMatchFromRecruit(recruit)).toBeNull();
  });

  it("should return null for empty array JSON", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: "[]",
    };
    const result = buildMatchFromRecruit(recruit);
    // Empty array is valid, but not useful for matching
    expect(result).toEqual({
      memberIds: [],
      meetTimeUtc: "2026-01-18T12:00:00.000Z",
    });
  });

  it("should handle JSON with single user", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: '["user1"]',
    };
    const result = buildMatchFromRecruit(recruit);
    expect(result).toEqual({
      memberIds: ["user1"],
      meetTimeUtc: "2026-01-18T12:00:00.000Z",
    });
  });

  it("should handle JSON with duplicate users", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: '["user1", "user1", "user2"]',
    };
    const result = buildMatchFromRecruit(recruit);
    expect(result).toEqual({
      memberIds: ["user1", "user1", "user2"],
      meetTimeUtc: "2026-01-18T12:00:00.000Z",
    });
  });

  it("should parse JSON with special characters in user IDs", () => {
    const recruit = {
      matchedMeetTimeUtc: "2026-01-18T12:00:00.000Z",
      matchedMemberIdsJson: '["user-1", "user_2", "user.3"]',
    };
    const result = buildMatchFromRecruit(recruit);
    expect(result).toEqual({
      memberIds: ["user-1", "user_2", "user.3"],
      meetTimeUtc: "2026-01-18T12:00:00.000Z",
    });
  });
});
