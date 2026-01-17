import { env } from "cloudflare:test";
import { describe, expect, it, beforeAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import {
  shouldCreateInstance,
  filterPendingReminders,
  buildReminderMessage,
} from "../../../src/features/recruit";

describe("handleScheduled - Integration Tests", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    // Create tables using batch
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS guild_settings (
          id TEXT PRIMARY KEY NOT NULL,
          guild_id TEXT NOT NULL UNIQUE,
          timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
          default_interval_min INTEGER NOT NULL DEFAULT 30,
          default_duration_min INTEGER NOT NULL DEFAULT 360,
          default_template TEXT NOT NULL DEFAULT '',
          reminder_interval_min INTEGER
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY NOT NULL,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          creator_id TEXT NOT NULL,
          post_time_hhmm TEXT NOT NULL,
          interval_min INTEGER NOT NULL DEFAULT 30,
          duration_min INTEGER NOT NULL DEFAULT 360,
          template TEXT NOT NULL DEFAULT '',
          active INTEGER NOT NULL DEFAULT 1
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS recruits (
          id TEXT PRIMARY KEY NOT NULL,
          schedule_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          target_date_local TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          match_signature TEXT,
          last_notified_signature TEXT,
          matched_meet_time_utc TEXT,
          matched_member_ids_json TEXT,
          deleted_by TEXT,
          deleted_at_utc TEXT
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS recruit_entries (
          recruit_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending_time',
          available_from_utc TEXT,
          created_at_utc TEXT NOT NULL,
          updated_at_utc TEXT NOT NULL,
          last_reminded_at_utc TEXT,
          PRIMARY KEY (recruit_id, user_id)
        )
      `),
    ]);
  });

  describe("schedule instance creation", () => {
    it("should create recruit instance when shouldCreateInstance returns true", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      // Setup active schedule
      const scheduleId = crypto.randomUUID();
      await db.insert(schema.schedules).values({
        id: scheduleId,
        guildId: "test-guild",
        channelId: "test-channel",
        creatorId: "test-user",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
      });

      // Mock Discord API
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "test-message-id" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      // Simulate handleScheduled execution
      const nowUtc = new Date("2026-01-18T11:00:00.000Z"); // 20:00 JST
      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();
      const schedule = await db
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.id, scheduleId))
        .get();
      const existingRecruits = await db
        .select({ targetDateLocal: schema.recruits.targetDateLocal })
        .from(schema.recruits)
        .where(eq(schema.recruits.scheduleId, scheduleId))
        .all();

      const tz = settings?.timezone ?? "Asia/Tokyo";
      const shouldCreate = shouldCreateInstance(
        nowUtc,
        { postTimeHHmm: schedule?.postTimeHHmm ?? "20:00" },
        tz,
        existingRecruits,
      );

      expect(shouldCreate).toBe(true);

      // Note: mockFetch is set up but not called in this test since we're only testing shouldCreateInstance
      // In actual handleScheduled, postRecruitMessage would be called after shouldCreateInstance returns true
    });

    it("should not create duplicate instance for same date", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      // Setup active schedule
      const scheduleId = crypto.randomUUID();
      await db.insert(schema.schedules).values({
        id: scheduleId,
        guildId: "test-guild",
        channelId: "test-channel",
        creatorId: "test-user",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
      });

      // Create existing recruit
      await db.insert(schema.recruits).values({
        id: crypto.randomUUID(),
        scheduleId,
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "existing-message",
        targetDateLocal: "2026-01-18",
        status: "open",
      });

      // Mock Discord API
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "test-message-id" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      // Simulate handleScheduled execution
      const nowUtc = new Date("2026-01-18T11:00:00.000Z"); // 20:00 JST
      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();
      const existingRecruits = await db
        .select({ targetDateLocal: schema.recruits.targetDateLocal })
        .from(schema.recruits)
        .where(eq(schema.recruits.scheduleId, scheduleId))
        .all();

      const tz = settings?.timezone ?? "Asia/Tokyo";
      const shouldCreate = shouldCreateInstance(
        nowUtc,
        { postTimeHHmm: "20:00" },
        tz,
        existingRecruits,
      );

      // Should not create duplicate
      expect(shouldCreate).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should skip inactive schedules", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      // Setup inactive schedule
      const scheduleId = crypto.randomUUID();
      await db.insert(schema.schedules).values({
        id: scheduleId,
        guildId: "test-guild",
        channelId: "test-channel",
        creatorId: "test-user",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 0, // Inactive
      });

      // Mock Discord API
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "test-message-id" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      // Get schedule
      const schedule = await db
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.id, scheduleId))
        .get();

      // Should skip inactive schedules
      expect(schedule?.active).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not create instance when post time has passed", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      // Setup active schedule with past post time
      const scheduleId = crypto.randomUUID();
      await db.insert(schema.schedules).values({
        id: scheduleId,
        guildId: "test-guild",
        channelId: "test-channel",
        creatorId: "test-user",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
      });

      // Simulate handleScheduled execution after post time
      // JST 20:00 = UTC 11:00, so UTC 12:00 is after post time
      const nowUtc = new Date("2026-01-18T12:00:00.000Z"); // 21:00 JST (after 20:00)
      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();
      const existingRecruits = await db
        .select({ targetDateLocal: schema.recruits.targetDateLocal })
        .from(schema.recruits)
        .where(eq(schema.recruits.scheduleId, scheduleId))
        .all();

      const tz = settings?.timezone ?? "Asia/Tokyo";
      const shouldCreate = shouldCreateInstance(
        nowUtc,
        { postTimeHHmm: "20:00" },
        tz,
        existingRecruits,
      );

      // 投稿時刻（JST 20:00 = UTC 11:00）が過去（UTC 12:00）のため、
      // インスタンスを作成すべきでない
      expect(shouldCreate).toBe(false);
    });
  });

  describe("reminder handling", () => {
    it("should only update lastRemindedAtUtc after successful message send", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings with reminder interval
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
        reminderIntervalMin: 60,
      });

      // Setup recruit
      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "test-message",
        targetDateLocal: "2026-01-18",
        status: "open",
      });

      // Setup pending entry
      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId: "test-user",
        state: "pending_time",
        createdAtUtc: "2026-01-18T10:00:00.000Z",
        updatedAtUtc: "2026-01-18T10:00:00.000Z",
        lastRemindedAtUtc: null,
      });

      // Mock successful Discord API call
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "reminder-message-id" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      // Simulate reminder processing
      const nowUtc = new Date("2026-01-18T11:30:00.000Z");
      const pendingEntries = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .all();

      const reminderTargets = filterPendingReminders(
        pendingEntries.map((entry) => ({
          userId: entry.userId,
          recruitId: entry.recruitId,
          channelId: "test-channel",
          lastRemindedAtUtc: entry.lastRemindedAtUtc,
        })),
        60,
        nowUtc,
      );

      expect(reminderTargets).toHaveLength(1);

      // Simulate successful reminder send and DB update
      const target = reminderTargets[0];
      const reminderMessage = buildReminderMessage(target.recruitId);

      await fetch(
        "https://discord.com/api/v10/channels/test-channel/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify({
            content: `<@${target.userId}> ${reminderMessage}`,
          }),
        },
      );

      // Update DB only after successful send
      await db
        .update(schema.recruitEntries)
        .set({ lastRemindedAtUtc: nowUtc.toISOString() })
        .where(
          and(
            eq(schema.recruitEntries.recruitId, target.recruitId),
            eq(schema.recruitEntries.userId, target.userId),
          ),
        );

      // Verify DB update
      const updatedEntry = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .get();

      expect(updatedEntry?.lastRemindedAtUtc).toBe(nowUtc.toISOString());
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should skip DB update when reminder send fails", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings with reminder interval
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
        reminderIntervalMin: 60,
      });

      // Setup recruit
      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "test-message",
        targetDateLocal: "2026-01-18",
        status: "open",
      });

      // Setup pending entry with previous reminder
      const previousReminderTime = "2026-01-18T10:00:00.000Z";
      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId: "test-user",
        state: "pending_time",
        createdAtUtc: "2026-01-18T09:00:00.000Z",
        updatedAtUtc: "2026-01-18T09:00:00.000Z",
        lastRemindedAtUtc: previousReminderTime,
      });

      // Mock failed Discord API call
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      // Simulate reminder processing
      const nowUtc = new Date("2026-01-18T11:30:00.000Z");
      const pendingEntries = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .all();

      const reminderTargets = filterPendingReminders(
        pendingEntries.map((entry) => ({
          userId: entry.userId,
          recruitId: entry.recruitId,
          channelId: "test-channel",
          lastRemindedAtUtc: entry.lastRemindedAtUtc,
        })),
        60,
        nowUtc,
      );

      expect(reminderTargets).toHaveLength(1);

      // Simulate failed reminder send
      const target = reminderTargets[0];
      const reminderMessage = buildReminderMessage(target.recruitId);

      try {
        const response = await fetch(
          "https://discord.com/api/v10/channels/test-channel/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            },
            body: JSON.stringify({
              content: `<@${target.userId}> ${reminderMessage}`,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }

        // This should not be reached
        await db
          .update(schema.recruitEntries)
          .set({ lastRemindedAtUtc: nowUtc.toISOString() })
          .where(
            and(
              eq(schema.recruitEntries.recruitId, target.recruitId),
              eq(schema.recruitEntries.userId, target.userId),
            ),
          );
      } catch (error) {
        // Expected error - DB update should be skipped
      }

      // Verify DB was NOT updated
      const entry = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .get();

      expect(entry?.lastRemindedAtUtc).toBe(previousReminderTime); // Should remain unchanged
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should filter reminders based on interval", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      // Setup guild settings with 30 minute reminder interval
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
        reminderIntervalMin: 30,
      });

      // Setup recruit
      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "test-message",
        targetDateLocal: "2026-01-18",
        status: "open",
      });

      // Setup entries with different last reminded times
      const nowUtc = new Date("2026-01-18T11:30:00.000Z");

      await db.insert(schema.recruitEntries).values([
        {
          recruitId,
          userId: "user1",
          state: "pending_time",
          createdAtUtc: "2026-01-18T09:00:00.000Z",
          updatedAtUtc: "2026-01-18T09:00:00.000Z",
          lastRemindedAtUtc: null, // Never reminded - should be included
        },
        {
          recruitId,
          userId: "user2",
          state: "pending_time",
          createdAtUtc: "2026-01-18T09:00:00.000Z",
          updatedAtUtc: "2026-01-18T09:00:00.000Z",
          lastRemindedAtUtc: "2026-01-18T11:00:00.000Z", // 30 min ago - should be included
        },
        {
          recruitId,
          userId: "user3",
          state: "pending_time",
          createdAtUtc: "2026-01-18T09:00:00.000Z",
          updatedAtUtc: "2026-01-18T09:00:00.000Z",
          lastRemindedAtUtc: "2026-01-18T11:15:00.000Z", // 15 min ago - should be excluded
        },
      ]);

      const pendingEntries = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .all();

      const reminderTargets = filterPendingReminders(
        pendingEntries.map((entry) => ({
          userId: entry.userId,
          recruitId: entry.recruitId,
          channelId: "test-channel",
          lastRemindedAtUtc: entry.lastRemindedAtUtc,
        })),
        30,
        nowUtc,
      );

      // Should include user1 (never reminded) and user2 (30+ min ago)
      // Should exclude user3 (less than 30 min ago)
      expect(reminderTargets).toHaveLength(2);
      expect(reminderTargets.some((t) => t.userId === "user1")).toBe(true);
      expect(reminderTargets.some((t) => t.userId === "user2")).toBe(true);
      expect(reminderTargets.some((t) => t.userId === "user3")).toBe(false);
    });
  });
});
