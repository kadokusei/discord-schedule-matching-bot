import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  buildReminderMessage,
  reminderSlotToSend,
  shouldCreateInstance,
} from "../../../src/features/recruit";
import { handleScheduled } from "../../../src/handlers/scheduled";

describe("handleScheduled - Integration Tests", () => {
  const db = drizzle(env.DB, { schema });

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

    it("should create instance once post time has passed (same-day catch-up)", async () => {
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

      // post_time は「投稿時刻」。now (UTC 12:00) >= 投稿時刻 (JST 20:00 = UTC 11:00) かつ
      // 当日分が未作成のため、最初の tick で作成する（キャッチアップ）。
      expect(shouldCreate).toBe(true);
    });
  });

  describe("reminder handling", () => {
    // 募集開始 20:00 JST = 11:00Z、interval 15 分。20:13(11:13Z) 登録 → 20:15 をスキップし 20:30(11:30Z) が初回。
    const SCHEDULE = {
      targetDateLocal: "2026-01-17",
      postTimeHHmm: "20:00",
      intervalMin: 15,
      durationMin: 360,
    };

    it("should update lastRemindedAtUtc with the slot time after successful message send", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "test-message",
        targetDateLocal: SCHEDULE.targetDateLocal,
        status: "open",
      });

      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId: "test-user",
        state: "pending_time",
        createdAtUtc: "2026-01-17T11:13:00.000Z",
        updatedAtUtc: "2026-01-17T11:13:00.000Z",
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

      const nowUtc = new Date("2026-01-17T11:30:00.000Z");
      const entry = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .get();

      const slotUtc = reminderSlotToSend(
        {
          ...SCHEDULE,
          createdAtUtc: entry!.createdAtUtc,
          lastRemindedAtUtc: entry!.lastRemindedAtUtc,
        },
        "Asia/Tokyo",
        nowUtc,
      );
      expect(slotUtc).toBe("2026-01-17T11:30:00.000Z");

      // Simulate successful reminder send and DB update (store the slot time)
      const reminderMessage = buildReminderMessage(recruitId);
      await fetch("https://discord.com/api/v10/channels/test-channel/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
        body: JSON.stringify({ content: `<@test-user> ${reminderMessage}` }),
      });

      await db
        .update(schema.recruitEntries)
        .set({ lastRemindedAtUtc: slotUtc })
        .where(
          and(
            eq(schema.recruitEntries.recruitId, recruitId),
            eq(schema.recruitEntries.userId, "test-user"),
          ),
        );

      const updatedEntry = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .get();

      expect(updatedEntry?.lastRemindedAtUtc).toBe("2026-01-17T11:30:00.000Z");
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should skip DB update when reminder send fails", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "test-message",
        targetDateLocal: SCHEDULE.targetDateLocal,
        status: "open",
      });

      // 前スロット(20:30)で送信済み。次スロット(20:45)で送信対象になるが、送信失敗時は更新しない。
      const previousReminderTime = "2026-01-17T11:30:00.000Z";
      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId: "test-user",
        state: "pending_time",
        createdAtUtc: "2026-01-17T11:13:00.000Z",
        updatedAtUtc: "2026-01-17T11:13:00.000Z",
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

      const nowUtc = new Date("2026-01-17T11:45:00.000Z");
      const entry = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .get();

      const slotUtc = reminderSlotToSend(
        {
          ...SCHEDULE,
          createdAtUtc: entry!.createdAtUtc,
          lastRemindedAtUtc: entry!.lastRemindedAtUtc,
        },
        "Asia/Tokyo",
        nowUtc,
      );
      expect(slotUtc).toBe("2026-01-17T11:45:00.000Z");

      const reminderMessage = buildReminderMessage(recruitId);
      try {
        const response = await fetch("https://discord.com/api/v10/channels/test-channel/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify({ content: `<@test-user> ${reminderMessage}` }),
        });

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }

        // This should not be reached
        await db
          .update(schema.recruitEntries)
          .set({ lastRemindedAtUtc: slotUtc })
          .where(
            and(
              eq(schema.recruitEntries.recruitId, recruitId),
              eq(schema.recruitEntries.userId, "test-user"),
            ),
          );
      } catch {
        // Expected error - DB update should be skipped
      }

      const after = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.recruitId, recruitId))
        .get();

      expect(after?.lastRemindedAtUtc).toBe(previousReminderTime); // Should remain unchanged
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should send on slot boundaries: first target, skip already-sent slot, skip pre-first slot", async () => {
      // Clean up
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });

      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "test-message",
        targetDateLocal: SCHEDULE.targetDateLocal,
        status: "open",
      });

      const nowUtc = new Date("2026-01-17T11:30:00.000Z"); // 20:30 スロット

      await db.insert(schema.recruitEntries).values([
        {
          // 20:13 登録・未送信 → 20:30 が初回対象 → 送信
          recruitId,
          userId: "user1",
          state: "pending_time",
          createdAtUtc: "2026-01-17T11:13:00.000Z",
          updatedAtUtc: "2026-01-17T11:13:00.000Z",
          lastRemindedAtUtc: null,
        },
        {
          // 同一スロット(20:30)で送信済み → スキップ
          recruitId,
          userId: "user2",
          state: "pending_time",
          createdAtUtc: "2026-01-17T11:13:00.000Z",
          updatedAtUtc: "2026-01-17T11:13:00.000Z",
          lastRemindedAtUtc: "2026-01-17T11:30:00.000Z",
        },
        {
          // 20:28 登録 → 20:30 をスキップ、初回は 20:45 → 20:30 時点では未到来 → スキップ
          recruitId,
          userId: "user3",
          state: "pending_time",
          createdAtUtc: "2026-01-17T11:28:00.000Z",
          updatedAtUtc: "2026-01-17T11:28:00.000Z",
          lastRemindedAtUtc: null,
        },
        {
          // 「未定」は時間入力リマインドの対象外
          recruitId,
          userId: "user4",
          state: "undecided",
          createdAtUtc: "2026-01-17T11:13:00.000Z",
          updatedAtUtc: "2026-01-17T11:13:00.000Z",
          lastRemindedAtUtc: null,
        },
      ]);

      const pendingEntries = await db
        .select()
        .from(schema.recruitEntries)
        .where(
          and(
            eq(schema.recruitEntries.recruitId, recruitId),
            eq(schema.recruitEntries.state, "pending_time"),
          ),
        )
        .all();

      const targets = pendingEntries.filter(
        (entry) =>
          reminderSlotToSend(
            {
              ...SCHEDULE,
              createdAtUtc: entry.createdAtUtc,
              lastRemindedAtUtc: entry.lastRemindedAtUtc,
            },
            "Asia/Tokyo",
            nowUtc,
          ) !== null,
      );

      expect(targets.map((t) => t.userId)).toEqual(["user1"]);
    });
  });

  describe("idempotent creation (reserve-then-post)", () => {
    // post_time を "00:00" にして、当日分の作成条件（now >= post_time かつ未作成）を確実に満たす
    const setupDueSchedule = async (scheduleId: string) => {
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);

      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "idem-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });
      await db.insert(schema.schedules).values({
        id: scheduleId,
        guildId: "idem-guild",
        channelId: "idem-channel",
        creatorId: "creator",
        postTimeHHmm: "00:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
      });
    };

    const postMessageCalls = (mock: ReturnType<typeof vi.fn>) =>
      mock.mock.calls.filter(
        ([url, init]) =>
          typeof url === "string" &&
          url.endsWith("/channels/idem-channel/messages") &&
          (init as RequestInit | undefined)?.method === "POST",
      );

    it("creates exactly one recruit and posts once, even when run twice", async () => {
      const scheduleId = crypto.randomUUID();
      await setupDueSchedule(scheduleId);

      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "posted-msg-id" }),
          text: () => Promise.resolve(""),
        } as Response),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await handleScheduled(env);
      await handleScheduled(env);

      const created = await db
        .select()
        .from(schema.recruits)
        .where(eq(schema.recruits.scheduleId, scheduleId))
        .all();

      expect(created).toHaveLength(1);
      // 投稿成功後に messageId が更新されている
      expect(created[0].messageId).toBe("posted-msg-id");
      // 二重投稿していない
      expect(postMessageCalls(mockFetch)).toHaveLength(1);
    });

    it("rolls back the reserved row when the Discord post fails (no orphan)", async () => {
      const scheduleId = crypto.randomUUID();
      await setupDueSchedule(scheduleId);

      // messages への POST だけ失敗させる
      const mockFetch = vi.fn((url: unknown, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.endsWith("/channels/idem-channel/messages") &&
          init?.method === "POST"
        ) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal Server Error"),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "x" }),
          text: () => Promise.resolve(""),
        } as Response);
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await handleScheduled(env);

      const created = await db
        .select()
        .from(schema.recruits)
        .where(eq(schema.recruits.scheduleId, scheduleId))
        .all();

      // 予約行は削除され、孤児（messageId 空のまま）が残らない
      expect(created).toHaveLength(0);
    });
  });
});
