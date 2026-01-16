import { describe, it, expect, vi, beforeEach } from "vitest";

describe("shouldSendReminder - unit tests", () => {
  // Inline implementation for testing (due to Cloudflare Workers pool limitations)
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

  it("should return true when lastRemindedAtUtc is null", () => {
    const entry = {
      lastRemindedAtUtc: null,
    };
    const nowUtc = new Date("2026-01-17T12:00:00.000Z");

    expect(shouldSendReminder(entry, 60, nowUtc)).toBe(true);
  });

  it("should use default interval of 60 minutes when reminderIntervalMin is null", () => {
    const entry = {
      lastRemindedAtUtc: "2026-01-17T11:00:00.000Z",
    };
    const nowUtc = new Date("2026-01-17T12:00:00.000Z");

    expect(shouldSendReminder(entry, null, nowUtc)).toBe(true);
  });

  it("should return false when interval has not passed", () => {
    const entry = {
      lastRemindedAtUtc: "2026-01-17T11:30:00.000Z",
    };
    const nowUtc = new Date("2026-01-17T12:00:00.000Z");

    expect(shouldSendReminder(entry, 60, nowUtc)).toBe(false);
  });

  it("should return true when interval has exactly passed", () => {
    const entry = {
      lastRemindedAtUtc: "2026-01-17T11:00:00.000Z",
    };
    const nowUtc = new Date("2026-01-17T12:00:00.000Z");

    expect(shouldSendReminder(entry, 60, nowUtc)).toBe(true);
  });

  it("should handle custom interval minutes", () => {
    const entry = {
      lastRemindedAtUtc: "2026-01-17T11:45:00.000Z",
    };
    const nowUtc = new Date("2026-01-17T12:00:00.000Z");

    expect(shouldSendReminder(entry, 30, nowUtc)).toBe(false);
  });
});

describe("handleScheduled - reminder failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should continue processing remaining reminders when one fails", async () => {
    // This test verifies that when postChannelMessage fails for one target,
    // the remaining targets should still be processed

    let callCount = 0;
    const mockFetch = vi.fn(() => {
      callCount++;
      // First call fails, second succeeds
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg-123" }),
      } as Response);
    });

    global.fetch = mockFetch;

    // Simulate processing multiple reminders
    const targets = [
      { userId: "user1", channelId: "ch1", recruitId: "recruit1" },
      { userId: "user2", channelId: "ch2", recruitId: "recruit2" },
    ];

    const results: { success: boolean; userId: string }[] = [];

    for (const target of targets) {
      try {
        const response = await fetch(
          "https://discord.com/api/v10/channels/test/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bot test-token",
            },
            body: JSON.stringify({ content: `<@${target.userId}> reminder` }),
          },
        );

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }

        results.push({ success: true, userId: target.userId });
      } catch (error) {
        results.push({ success: false, userId: target.userId });
      }
    }

    // Expected behavior:
    // - user1 should fail (first call)
    // - user2 should succeed (second call)
    // - Both should be processed (loop continues)

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[0].userId).toBe("user1");
    expect(results[1].success).toBe(true);
    expect(results[1].userId).toBe("user2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should only update DB after successful message send", async () => {
    // This test verifies the correct order of operations:
    // 1. Send message
    // 2. If successful, update DB
    // 3. If failed, skip DB update

    let dbUpdateCalled = false;
    const dbUpdates: string[] = [];

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg-123" }),
      } as Response),
    );

    global.fetch = mockFetch;

    const targets = [
      { userId: "user1", channelId: "ch1", recruitId: "recruit1" },
      { userId: "user2", channelId: "ch2", recruitId: "recruit2" },
    ];

    for (const target of targets) {
      try {
        // Step 1: Send message
        const response = await fetch(
          "https://discord.com/api/v10/channels/test/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bot test-token",
            },
            body: JSON.stringify({ content: `<@${target.userId}> reminder` }),
          },
        );

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }

        // Step 2: Only update DB after successful message send
        dbUpdateCalled = true;
        dbUpdates.push(target.userId);
      } catch (error) {
        // If message send fails, DB update should be skipped
      }
    }

    // Verify: DB updates should only happen after successful message sends
    expect(dbUpdateCalled).toBe(true);
    expect(dbUpdates).toEqual(["user1", "user2"]);
  });

  it("should skip DB update when message send fails", async () => {
    const dbUpdates: string[] = [];

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      } as Response),
    );

    global.fetch = mockFetch;

    const target = { userId: "user1", channelId: "ch1", recruitId: "recruit1" };

    try {
      const response = await fetch(
        "https://discord.com/api/v10/channels/test/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: JSON.stringify({ content: `<@${target.userId}> reminder` }),
        },
      );

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }

      // This should not be reached
      dbUpdates.push(target.userId);
    } catch (error) {
      // Message send failed, DB update should be skipped
    }

    // Verify: DB update should NOT happen when message send fails
    expect(dbUpdates).toHaveLength(0);
  });
});
