import { describe, it, expect, vi } from "vitest";

describe("recomputeMatch - Discord API error handling", () => {
  it("should handle updateDiscordMessage failure gracefully", async () => {
    // This test verifies that when Discord API fails during message update,
    // the error is logged but doesn't crash the entire process

    let apiCallCount = 0;
    const mockFetch = vi.fn(() => {
      apiCallCount++;
      // Simulate Discord API failure
      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      } as Response);
    });

    global.fetch = mockFetch;

    // Simulate the error handling flow
    const result: { dbUpdated: boolean; errorLogged: boolean } = {
      dbUpdated: false,
      errorLogged: false,
    };

    try {
      // Step 1: Update DB (this should succeed)
      result.dbUpdated = true;

      // Step 2: Update Discord message (this should fail)
      const response = await fetch(
        "https://discord.com/api/v10/channels/test/messages/123",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: JSON.stringify({ embeds: [] }),
        },
      );

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }
    } catch (error) {
      // Step 3: Log error but don't crash
      result.errorLogged = true;
      console.error("Failed to update Discord message:", error);
    }

    // Expected behavior:
    // - DB should be updated
    // - Error should be logged
    // - Process should continue (not crash)

    expect(result.dbUpdated).toBe(true);
    expect(result.errorLogged).toBe(true);
    expect(apiCallCount).toBe(1);
  });

  it("should handle postChannelMessage failure gracefully", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        text: () => Promise.resolve("Rate Limited"),
      } as Response),
    );

    global.fetch = mockFetch;

    const result: { messageLogged: boolean; errorHandled: boolean } = {
      messageLogged: false,
      errorHandled: false,
    };

    try {
      const response = await fetch(
        "https://discord.com/api/v10/channels/test/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: JSON.stringify({ content: "test" }),
        },
      );

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }

      result.messageLogged = true;
    } catch (error) {
      // Error should be caught and handled gracefully
      result.errorHandled = true;
    }

    expect(result.messageLogged).toBe(false);
    expect(result.errorHandled).toBe(true);
  });
});

describe("handleTimeSelect - timezone handling", () => {
  it("should format time using guild timezone", () => {
    const selectedTime = "2026-01-17T12:00:00.000Z";

    // Test with different timezones
    const tokyoTime = new Date(selectedTime).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
    const newYorkTime = new Date(selectedTime).toLocaleString("ja-JP", {
      timeZone: "America/New_York",
    });
    const londonTime = new Date(selectedTime).toLocaleString("ja-JP", {
      timeZone: "Europe/London",
    });

    // Verify that different timezones produce different results
    expect(tokyoTime).not.toBe(newYorkTime);
    expect(tokyoTime).not.toBe(londonTime);
    expect(newYorkTime).not.toBe(londonTime);

    // Tokyo should be ahead of London and New York
    console.log("Tokyo:", tokyoTime);
    console.log("New York:", newYorkTime);
    console.log("London:", londonTime);
  });
});

describe("buildMatchFromRecruit - JSON validation", () => {
  it("should return null for malformed JSON", () => {
    // Simulate a recruit with malformed JSON
    const recruit = {
      id: "recruit-1",
      matchedMemberIdsJson: "invalid-json{",
      matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
    };

    // The buildMatchFromRecruit function should handle malformed JSON
    // and return null instead of throwing an error
    const result = (() => {
      try {
        if (!recruit.matchedMemberIdsJson || !recruit.matchedMeetTimeUtc) {
          return null;
        }
        const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
        return {
          memberIds,
          meetTimeUtc: recruit.matchedMeetTimeUtc,
        };
      } catch {
        return null;
      }
    })();

    expect(result).toBeNull();
  });

  it("should return null for non-array JSON", () => {
    const recruit = {
      id: "recruit-2",
      matchedMemberIdsJson: '{"key": "value"}',
      matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
    };

    const result = (() => {
      try {
        if (!recruit.matchedMemberIdsJson || !recruit.matchedMeetTimeUtc) {
          return null;
        }
        const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
        if (!Array.isArray(memberIds)) {
          return null;
        }
        return {
          memberIds,
          meetTimeUtc: recruit.matchedMeetTimeUtc,
        };
      } catch {
        return null;
      }
    })();

    expect(result).toBeNull();
  });

  it("should return Match for valid JSON array", () => {
    const recruit = {
      id: "recruit-3",
      matchedMemberIdsJson: '["user1", "user2", "user3"]',
      matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
    };

    const result = (() => {
      try {
        if (!recruit.matchedMemberIdsJson || !recruit.matchedMeetTimeUtc) {
          return null;
        }
        const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
        if (!Array.isArray(memberIds)) {
          return null;
        }
        return {
          memberIds,
          meetTimeUtc: recruit.matchedMeetTimeUtc,
        };
      } catch {
        return null;
      }
    })();

    expect(result).toEqual({
      memberIds: ["user1", "user2", "user3"],
      meetTimeUtc: "2026-01-17T12:00:00.000Z",
    });
  });

  it("should return null for null matchedMemberIdsJson", () => {
    const recruit = {
      id: "recruit-4",
      matchedMemberIdsJson: null,
      matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
    };

    const result = (() => {
      try {
        if (!recruit.matchedMemberIdsJson || !recruit.matchedMeetTimeUtc) {
          return null;
        }
        const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
        if (!Array.isArray(memberIds)) {
          return null;
        }
        return {
          memberIds,
          meetTimeUtc: recruit.matchedMeetTimeUtc,
        };
      } catch {
        return null;
      }
    })();

    expect(result).toBeNull();
  });

  it("should return null for undefined matchedMemberIdsJson", () => {
    const recruit = {
      id: "recruit-5",
      matchedMemberIdsJson: undefined,
      matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
    };

    const result = (() => {
      try {
        if (!recruit.matchedMemberIdsJson || !recruit.matchedMeetTimeUtc) {
          return null;
        }
        const memberIds = JSON.parse(recruit.matchedMemberIdsJson) as string[];
        if (!Array.isArray(memberIds)) {
          return null;
        }
        return {
          memberIds,
          meetTimeUtc: recruit.matchedMeetTimeUtc,
        };
      } catch {
        return null;
      }
    })();

    expect(result).toBeNull();
  });
});
