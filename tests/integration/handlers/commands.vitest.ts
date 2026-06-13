import { env } from "cloudflare:test";
import type { APIApplicationCommandInteraction } from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { handleCommandInteraction } from "../../../src/handlers/commands";

type SubOption = { name: string; value: string | number; type?: number };

// サブコマンドのネストした APPLICATION_COMMAND ペイロードを構築する
const buildCommandInteraction = (
  commandName: string,
  subName: string,
  options: SubOption[],
  ctxIds: { guildId?: string; channelId?: string; userId?: string } = {},
): APIApplicationCommandInteraction =>
  ({
    type: 2,
    id: "interaction-id",
    application_id: "test-app-id",
    token: "interaction-token",
    guild_id: ctxIds.guildId,
    channel: ctxIds.channelId ? { id: ctxIds.channelId } : undefined,
    member: ctxIds.userId ? { user: { id: ctxIds.userId } } : undefined,
    data: {
      id: "cmd-id",
      name: commandName,
      type: 1,
      options: [
        {
          type: 1, // SUB_COMMAND
          name: subName,
          options: options.map((o) => ({ type: o.type ?? 3, name: o.name, value: o.value })),
        },
      ],
    },
  }) as unknown as APIApplicationCommandInteraction;

const noopCtx = { waitUntil: () => {} };

const dispatch = (interaction: APIApplicationCommandInteraction) =>
  handleCommandInteraction(interaction, env, noopCtx);

describe("Command Handlers - Integration Tests", () => {
  const db = drizzle(env.DB, { schema });

  beforeEach(async () => {
    await db.delete(schema.recruitEntries);
    await db.delete(schema.recruits);
    await db.delete(schema.schedules);
    await db.delete(schema.guildSettings);
    await db.delete(schema.riotAccounts);
    vi.clearAllMocks();
  });

  describe("/schedule create", () => {
    it("should create schedule with provided options", async () => {
      await dispatch(
        buildCommandInteraction(
          "schedule",
          "create",
          [
            { name: "post_time", value: "20:00" },
            { name: "interval", value: 60, type: 4 },
            { name: "duration", value: 180, type: 4 },
          ],
          { guildId: "test-guild", channelId: "test-channel", userId: "test-user" },
        ),
      );

      const schedules = await db.select().from(schema.schedules).all();
      expect(schedules).toHaveLength(1);
      expect(schedules[0]?.postTimeHHmm).toBe("20:00");
      expect(schedules[0]?.intervalMin).toBe(60);
      expect(schedules[0]?.durationMin).toBe(180);
    });

    it("should use default settings when options not provided", async () => {
      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 45,
        defaultDurationMin: 240,
      });

      await dispatch(
        buildCommandInteraction("schedule", "create", [{ name: "post_time", value: "21:00" }], {
          guildId: "test-guild",
          channelId: "test-channel",
          userId: "test-user",
        }),
      );

      const schedules = await db.select().from(schema.schedules).all();
      expect(schedules[0]?.intervalMin).toBe(45);
      expect(schedules[0]?.durationMin).toBe(240);
    });

    it("should return error for invalid time format", async () => {
      const response = await dispatch(
        buildCommandInteraction("schedule", "create", [{ name: "post_time", value: "invalid" }], {
          guildId: "test-guild",
          channelId: "test-channel",
          userId: "test-user",
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("エラー");
    });
  });

  describe("/schedule settings", () => {
    it("should update timezone for existing guild", async () => {
      const existingId = crypto.randomUUID();
      await db.insert(schema.guildSettings).values({
        id: existingId,
        guildId: "test-guild",
        timezone: "America/New_York",
      });

      await dispatch(
        buildCommandInteraction(
          "schedule",
          "settings",
          [{ name: "timezone", value: "Asia/Tokyo" }],
          { guildId: "test-guild" },
        ),
      );

      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();

      expect(settings?.timezone).toBe("Asia/Tokyo");
      expect(settings?.id).toBe(existingId);
    });

    it("should create new settings for new guild", async () => {
      await dispatch(
        buildCommandInteraction("schedule", "settings", [{ name: "timezone", value: "UTC" }], {
          guildId: "test-guild",
        }),
      );

      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();

      expect(settings?.timezone).toBe("UTC");
    });
  });

  describe("/schedule list", () => {
    const insertSchedule = (overrides: Partial<typeof schema.schedules.$inferInsert> = {}) =>
      db.insert(schema.schedules).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        channelId: "test-channel",
        creatorId: "test-user",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
        ...overrides,
      });

    it("should report when there are no schedules", async () => {
      const response = await dispatch(
        buildCommandInteraction("schedule", "list", [], { guildId: "test-guild" }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain(
        "登録されている定期予定はありません",
      );
    });

    it("should list all schedules in the guild", async () => {
      await insertSchedule({ postTimeHHmm: "20:00", intervalMin: 60, durationMin: 180 });
      await insertSchedule({ postTimeHHmm: "21:30", active: 0 });

      const response = await dispatch(
        buildCommandInteraction("schedule", "list", [], { guildId: "test-guild" }),
      );

      const content = (response as { data?: { content?: string } }).data?.content ?? "";
      expect(content).toContain("20:00");
      expect(content).toContain("21:30");
      expect(content).toContain("60");
      expect(content).toContain("180");
      // 停止中の予定が区別表示されること
      expect(content).toContain("停止中");
    });

    it("should not list schedules from other guilds", async () => {
      await insertSchedule({ guildId: "other-guild", postTimeHHmm: "08:00" });

      const response = await dispatch(
        buildCommandInteraction("schedule", "list", [], { guildId: "test-guild" }),
      );

      const content = (response as { data?: { content?: string } }).data?.content ?? "";
      expect(content).toContain("登録されている定期予定はありません");
      expect(content).not.toContain("08:00");
    });
  });

  describe("/schedule delete", () => {
    const insertSchedule = (
      id: string,
      overrides: Partial<typeof schema.schedules.$inferInsert> = {},
    ) =>
      db.insert(schema.schedules).values({
        id,
        guildId: "test-guild",
        channelId: "test-channel",
        creatorId: "owner-user",
        postTimeHHmm: "20:00",
        intervalMin: 30,
        durationMin: 360,
        template: "",
        active: 1,
        ...overrides,
      });

    it("should delete the schedule and its recruits/entries", async () => {
      const fetchMock = vi.fn((_url: unknown, _init?: RequestInit) =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const scheduleId = "sched-1";
      await insertSchedule(scheduleId);
      await db.insert(schema.recruits).values({
        id: "recruit-1",
        scheduleId,
        guildId: "test-guild",
        channelId: "test-channel",
        messageId: "msg-1",
        targetDateLocal: "2026-06-15",
        status: "open",
      });
      await db.insert(schema.recruitEntries).values({
        recruitId: "recruit-1",
        userId: "test-user",
        state: "confirmed",
        createdAtUtc: new Date().toISOString(),
        updatedAtUtc: new Date().toISOString(),
      });

      const response = await dispatch(
        buildCommandInteraction("schedule", "delete", [{ name: "id", value: scheduleId }], {
          guildId: "test-guild",
          userId: "owner-user",
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("削除しました");

      expect(await db.select().from(schema.schedules).all()).toHaveLength(0);
      expect(await db.select().from(schema.recruits).all()).toHaveLength(0);
      expect(await db.select().from(schema.recruitEntries).all()).toHaveLength(0);

      // open な募集の Discord メッセージ削除（DELETE）が呼ばれること
      const deleteCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
      expect(deleteCalls.length).toBe(1);
    });

    it("should allow deletion by a non-creator (anyone can delete)", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response),
      );

      const scheduleId = "sched-2";
      await insertSchedule(scheduleId, { creatorId: "owner-user" });

      const response = await dispatch(
        buildCommandInteraction("schedule", "delete", [{ name: "id", value: scheduleId }], {
          guildId: "test-guild",
          userId: "different-user",
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("削除しました");
      expect(await db.select().from(schema.schedules).all()).toHaveLength(0);
    });

    it("should return error for non-existent schedule", async () => {
      const response = await dispatch(
        buildCommandInteraction("schedule", "delete", [{ name: "id", value: "missing-id" }], {
          guildId: "test-guild",
          userId: "test-user",
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("エラー");
    });

    it("should not delete a schedule belonging to another guild", async () => {
      const scheduleId = "sched-3";
      await insertSchedule(scheduleId, { guildId: "other-guild" });

      const response = await dispatch(
        buildCommandInteraction("schedule", "delete", [{ name: "id", value: scheduleId }], {
          guildId: "test-guild",
          userId: "test-user",
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("エラー");
      expect(await db.select().from(schema.schedules).all()).toHaveLength(1);
    });
  });

  describe("/riot list", () => {
    it("should return empty message when no accounts", async () => {
      const response = await dispatch(
        buildCommandInteraction("riot", "list", [], { userId: "test-user" }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toBe(
        "登録されているアカウントはありません",
      );
    });

    it("should list all user accounts with parsed rank", async () => {
      const userId = "test-user";
      await db.insert(schema.riotAccounts).values([
        {
          id: crypto.randomUUID(),
          userId,
          gameName: "Player1",
          tagLine: "123",
          region: "ap",
          rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          userId,
          gameName: "Player2",
          tagLine: "456",
          region: "ap",
          rank: JSON.stringify({ tier: 15, division: "1", rank: "Platinum 1" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
      ]);

      const response = await dispatch(buildCommandInteraction("riot", "list", [], { userId }));

      const content = (response as { data?: { content?: string } }).data?.content ?? "";
      expect(content).toContain("Player1#123 (Gold 2)");
      expect(content).toContain("Player2#456 (Platinum 1)");
      // 生 JSON ではなく rank.rank が表示されること
      expect(content).not.toContain("tier");
    });

    it("should return only accounts for the requesting user", async () => {
      await db.insert(schema.riotAccounts).values([
        {
          id: crypto.randomUUID(),
          userId: "user1",
          gameName: "Player1",
          tagLine: "123",
          region: "ap",
          rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          userId: "user2",
          gameName: "Player2",
          tagLine: "456",
          region: "ap",
          rank: JSON.stringify({ tier: 15, division: "1", rank: "Platinum 1" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
      ]);

      const response = await dispatch(
        buildCommandInteraction("riot", "list", [], { userId: "user1" }),
      );

      const content = (response as { data?: { content?: string } }).data?.content ?? "";
      expect(content).toContain("Player1#123");
      expect(content).not.toContain("Player2#456");
    });
  });

  describe("/schedule help", () => {
    it("should return ephemeral usage for all schedule subcommands without DB writes", async () => {
      const response = await dispatch(buildCommandInteraction("schedule", "help", []));

      const data = (response as { data?: { content?: string; flags?: number } }).data;
      const content = data?.content ?? "";
      // ephemeral（本人のみ表示）であること
      expect((data?.flags ?? 0) & 64).toBe(64);
      // 各サブコマンド名が使い方として含まれること
      expect(content).toContain("create");
      expect(content).toContain("settings");
      expect(content).toContain("list");
      expect(content).toContain("delete");

      // 副作用がないこと
      const schedules = await db.select().from(schema.schedules).all();
      expect(schedules).toHaveLength(0);
    });
  });

  describe("/riot help", () => {
    it("should return ephemeral usage for all riot subcommands without DB writes", async () => {
      const response = await dispatch(buildCommandInteraction("riot", "help", []));

      const data = (response as { data?: { content?: string; flags?: number } }).data;
      const content = data?.content ?? "";
      expect((data?.flags ?? 0) & 64).toBe(64);
      expect(content).toContain("add");
      expect(content).toContain("remove");
      expect(content).toContain("list");

      const accounts = await db.select().from(schema.riotAccounts).all();
      expect(accounts).toHaveLength(0);
    });
  });
});
