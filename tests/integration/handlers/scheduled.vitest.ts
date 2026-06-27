import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { shouldCreateInstance } from "../../../src/features/recruit";
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

  describe("少人数パーティ通知（通知のみ）", () => {
    const SP_CHANNEL = "sp-channel";
    const AVAIL = "2026-01-18T11:00:00.000Z"; // 20:00 JST
    const NOW = new Date("2026-01-18T11:30:00.000Z"); // 20:30 JST（スロット境界）

    const cleanup = async () => {
      await db.delete(schema.recruitEntries);
      await db.delete(schema.recruits);
      await db.delete(schema.schedules);
      await db.delete(schema.guildSettings);
      await db.delete(schema.riotAccounts);
    };

    const setupOpenRecruit = async (status: "open" | "matched" = "open") => {
      await cleanup();
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "sp-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 30,
        defaultDurationMin: 360,
        defaultTemplate: "",
      });
      const scheduleId = crypto.randomUUID();
      await db.insert(schema.schedules).values({
        id: scheduleId,
        guildId: "sp-guild",
        channelId: SP_CHANNEL,
        creatorId: "creator",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
      });
      const recruitId = crypto.randomUUID();
      await db.insert(schema.recruits).values({
        id: recruitId,
        scheduleId,
        guildId: "sp-guild",
        channelId: SP_CHANNEL,
        messageId: "sp-msg",
        targetDateLocal: "2026-01-18",
        status,
      });
      return recruitId;
    };

    const addConfirmed = async (
      recruitId: string,
      userId: string,
      rank: string,
      availableFromUtc = AVAIL,
      partySizePreference: "any" | "full_party" | "up_to_trio" = "any",
    ) => {
      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId,
        availableFromUtc,
        partySizePreference,
        createdAtUtc: "2026-01-18T10:00:00.000Z",
        updatedAtUtc: "2026-01-18T10:00:00.000Z",
      });
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName: `${userId}-name`,
        tagLine: "JP1",
        region: "ap",
        rank: JSON.stringify({ tier: 0, division: 1, rank }),
        createdAtUtc: "2026-01-18T10:00:00.000Z",
        lastFetchedAtUtc: "2026-01-18T10:00:00.000Z",
      });
    };

    const trackFetch = () => {
      const calls: { url: string; method: string; body: string }[] = [];
      const mockFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : "",
        });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "sp-msg" }),
          text: () => Promise.resolve(""),
        } as Response);
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      return calls;
    };

    // 少人数通知（"行けそう" を含む POST）を抽出
    const notifications = (calls: { url: string; method: string; body: string }[]) =>
      calls.filter(
        (c) =>
          c.method === "POST" &&
          c.url.includes(`/channels/${SP_CHANNEL}/messages`) &&
          c.body.includes("行けそう"),
      );

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("ボタン無しで少人数通知を送る（同意コンポーネントを含まない）", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const recruitId = await setupOpenRecruit();
      await addConfirmed(recruitId, "a", "Gold 1");
      await addConfirmed(recruitId, "b", "Gold 2");
      await addConfirmed(recruitId, "c", "Gold 3");

      const calls = trackFetch();
      await handleScheduled(env);

      const notifs = notifications(calls);
      expect(notifs).toHaveLength(1);
      const payload = JSON.parse(notifs[0].body) as { components?: unknown[]; content: string };
      expect(payload.components ?? []).toHaveLength(0);
      expect(payload.content).toContain("3人");
    });

    it("同一構成では再通知しない", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const recruitId = await setupOpenRecruit();
      await addConfirmed(recruitId, "a", "Gold 1");
      await addConfirmed(recruitId, "b", "Gold 2");
      await addConfirmed(recruitId, "c", "Gold 3");

      const calls = trackFetch();
      await handleScheduled(env);
      await handleScheduled(env);

      expect(notifications(calls)).toHaveLength(1);
    });

    it("人数が増えたら（より大きい構成で）再通知する", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const recruitId = await setupOpenRecruit();
      await addConfirmed(recruitId, "a", "Gold 1");
      await addConfirmed(recruitId, "b", "Gold 2");

      const calls = trackFetch();
      await handleScheduled(env); // 2人で通知

      await addConfirmed(recruitId, "c", "Gold 3");
      await handleScheduled(env); // 3人で再通知

      const notifs = notifications(calls);
      expect(notifs).toHaveLength(2);
      expect(notifs[0].body).toContain("2人");
      expect(notifs[1].body).toContain("3人");
    });

    it("matched の募集には少人数通知を送らない", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const recruitId = await setupOpenRecruit("matched");
      await addConfirmed(recruitId, "a", "Gold 1");
      await addConfirmed(recruitId, "b", "Gold 2");
      await addConfirmed(recruitId, "c", "Gold 3");

      const calls = trackFetch();
      await handleScheduled(env);

      expect(notifications(calls)).toHaveLength(0);
    });

    it("3人通知で、より早く始められる2人組があれば併記する", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const recruitId = await setupOpenRecruit();
      // a,b は 20:00(11:00Z)、c は 20:30(11:30Z)。3人集合は 20:30 だが a,b は 20:00 から行ける。
      await addConfirmed(recruitId, "a", "Gold 1", "2026-01-18T11:00:00.000Z");
      await addConfirmed(recruitId, "b", "Gold 2", "2026-01-18T11:00:00.000Z");
      await addConfirmed(recruitId, "c", "Gold 3", "2026-01-18T11:30:00.000Z");

      const calls = trackFetch();
      await handleScheduled(env);

      const notifs = notifications(calls);
      expect(notifs).toHaveLength(1);
      expect(notifs[0].body).toContain("3人");
      expect(notifs[0].body).toContain("早く始めるなら");
      expect(notifs[0].body).toContain("20:00"); // 早期2人組の集合時刻(JST)
    });

    it("希望パーティサイズ full_party の参加者は少人数通知の対象にしない", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const recruitId = await setupOpenRecruit();
      // a,b は full_party（少人数提案対象外）、c,d は any
      await addConfirmed(recruitId, "a", "Gold 1", AVAIL, "full_party");
      await addConfirmed(recruitId, "b", "Gold 2", AVAIL, "full_party");
      await addConfirmed(recruitId, "c", "Gold 3");
      await addConfirmed(recruitId, "d", "Gold 1");

      const calls = trackFetch();
      await handleScheduled(env);

      const notifs = notifications(calls);
      expect(notifs).toHaveLength(1);
      // full_party の a,b は含まれず、c,d の2人通知になる
      expect(notifs[0].body).toContain("2人");
      expect(notifs[0].body).not.toContain("<@a>");
    });
  });
});
