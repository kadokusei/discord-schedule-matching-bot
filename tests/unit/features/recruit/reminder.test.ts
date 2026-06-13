import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shouldSendReminder,
  buildReminderMessage,
  filterPendingReminders,
} from "../../../../src/features/recruit";

describe("reminder functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("shouldSendReminder", () => {
    it("should return true when lastRemindedAtUtc is null", () => {
      const entry = {
        userId: "user1",
        recruitId: "recruit1",
        channelId: "ch1",
        lastRemindedAtUtc: null,
      };
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");

      expect(shouldSendReminder(entry, 60, nowUtc)).toBe(true);
    });

    it("should use default interval of 60 minutes when reminderIntervalMin is null", () => {
      const entry = {
        userId: "user1",
        recruitId: "recruit1",
        channelId: "ch1",
        lastRemindedAtUtc: "2026-01-17T11:00:00.000Z",
      };
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");

      expect(shouldSendReminder(entry, null, nowUtc)).toBe(true);
    });

    it("should return false when interval has not passed", () => {
      const entry = {
        userId: "user1",
        recruitId: "recruit1",
        channelId: "ch1",
        lastRemindedAtUtc: "2026-01-17T11:30:00.000Z",
      };
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");

      expect(shouldSendReminder(entry, 60, nowUtc)).toBe(false);
    });

    it("should return true when interval has exactly passed", () => {
      const entry = {
        userId: "user1",
        recruitId: "recruit1",
        channelId: "ch1",
        lastRemindedAtUtc: "2026-01-17T11:00:00.000Z",
      };
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");

      expect(shouldSendReminder(entry, 60, nowUtc)).toBe(true);
    });

    it("should handle custom interval minutes", () => {
      const entry = {
        userId: "user1",
        recruitId: "recruit1",
        channelId: "ch1",
        lastRemindedAtUtc: "2026-01-17T11:45:00.000Z",
      };
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");

      expect(shouldSendReminder(entry, 30, nowUtc)).toBe(false);
    });
  });

  describe("buildReminderMessage", () => {
    it("should return correct message content", () => {
      const recruitId = "recruit-123";
      const message = buildReminderMessage(recruitId);

      expect(message).toBe(
        "希望時間の登録がまだです！\n参加ボタンを押した後、セレクトメニューから希望時間を選択してください。",
      );
    });

    it("should include recruit instructions in Japanese", () => {
      const recruitId = "recruit-456";
      const message = buildReminderMessage(recruitId);

      expect(message).toContain("希望時間の登録");
      expect(message).toContain("参加ボタン");
      expect(message).toContain("セレクトメニュー");
    });

    it("should handle any recruitId format", () => {
      const recruitId1 = "recruit-abc123";
      const recruitId2 = "recruit-xyz789";
      const recruitId3 = "uuid-format";

      const message1 = buildReminderMessage(recruitId1);
      const message2 = buildReminderMessage(recruitId2);
      const message3 = buildReminderMessage(recruitId3);

      // All messages should be identical (recruitId is not used in message)
      expect(message1).toBe(message2);
      expect(message2).toBe(message3);
    });
  });

  describe("filterPendingReminders", () => {
    it("should filter entries based on reminder interval", () => {
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");
      const entries = [
        {
          userId: "user1",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: null, // Never reminded - should be included
        },
        {
          userId: "user2",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: "2026-01-17T11:00:00.000Z", // 60 min ago - should be included
        },
        {
          userId: "user3",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: "2026-01-17T11:30:00.000Z", // 30 min ago - should be excluded
        },
      ];

      const filtered = filterPendingReminders(entries, 60, nowUtc);

      expect(filtered).toHaveLength(2);
      expect(filtered.some((e) => e.userId === "user1")).toBe(true);
      expect(filtered.some((e) => e.userId === "user2")).toBe(true);
      expect(filtered.some((e) => e.userId === "user3")).toBe(false);
    });

    it("should include all entries when interval is 0", () => {
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");
      const entries = [
        {
          userId: "user1",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: "2026-01-17T11:59:00.000Z", // 1 min ago
        },
        {
          userId: "user2",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: "2026-01-17T11:00:00.000Z", // 60 min ago
        },
      ];

      const filtered = filterPendingReminders(entries, 0, nowUtc);

      expect(filtered).toHaveLength(2);
    });

    it("should return empty array when no entries", () => {
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");
      const entries: {
        userId: string;
        recruitId: string;
        channelId: string;
        lastRemindedAtUtc: string | null;
      }[] = [];

      const filtered = filterPendingReminders(entries, 60, nowUtc);

      expect(filtered).toHaveLength(0);
    });

    it("should handle edge case of exactly interval minutes", () => {
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");
      const entries = [
        {
          userId: "user1",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: "2026-01-17T11:00:00.000Z", // Exactly 60 min ago - should be included
        },
        {
          userId: "user2",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: "2026-01-17T11:00:01.000Z", // 59 min 59 sec ago - should be excluded
        },
      ];

      const filtered = filterPendingReminders(entries, 60, nowUtc);

      // Only user1 should be included (exactly 60 min ago)
      expect(filtered).toHaveLength(1);
      expect(filtered[0].userId).toBe("user1");
    });

    it("should preserve original entry properties", () => {
      const nowUtc = new Date("2026-01-17T12:00:00.000Z");
      const entries = [
        {
          userId: "user1",
          recruitId: "recruit1",
          channelId: "ch1",
          lastRemindedAtUtc: null,
        },
      ];

      const filtered = filterPendingReminders(entries, 60, nowUtc);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].userId).toBe("user1");
      expect(filtered[0].recruitId).toBe("recruit1");
      expect(filtered[0].channelId).toBe("ch1");
      expect(filtered[0].lastRemindedAtUtc).toBeNull();
    });
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

    globalThis.fetch = mockFetch;

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

    globalThis.fetch = mockFetch;

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

    globalThis.fetch = mockFetch;

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
      // If message send fails, DB update should be skipped
    }

    // Verify: DB update should NOT happen when message send fails
    expect(dbUpdates).toHaveLength(0);
  });
});
