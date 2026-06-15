import { env } from "cloudflare:test";
import type { APIApplicationCommandInteraction } from "discord-api-types/v10";
import { PermissionFlagsBits } from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { handleAutocomplete, handleCommandInteraction } from "../../../src/handlers/commands";

type SubOption = { name: string; value: string | number; type?: number };

// サブコマンドのネストした APPLICATION_COMMAND ペイロードを構築する
const buildCommandInteraction = (
  commandName: string,
  subName: string,
  options: SubOption[],
  ctxIds: { guildId?: string; channelId?: string; userId?: string; permissions?: string } = {},
): APIApplicationCommandInteraction =>
  ({
    type: 2,
    id: "interaction-id",
    application_id: "test-app-id",
    token: "interaction-token",
    guild_id: ctxIds.guildId,
    channel: ctxIds.channelId ? { id: ctxIds.channelId } : undefined,
    member: ctxIds.userId
      ? { user: { id: ctxIds.userId }, permissions: ctxIds.permissions }
      : undefined,
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

    it("should reject options that exceed the 25-option time menu limit", async () => {
      // interval 5分 / duration 360分 → 73個 > 25
      const response = await dispatch(
        buildCommandInteraction(
          "schedule",
          "create",
          [
            { name: "post_time", value: "20:00" },
            { name: "interval", value: 5, type: 4 },
            { name: "duration", value: 360, type: 4 },
          ],
          { guildId: "test-guild", channelId: "test-channel", userId: "test-user" },
        ),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("25");
      const schedules = await db.select().from(schema.schedules).all();
      expect(schedules).toHaveLength(0);
    });

    it("should reject when default fallback exceeds the limit even if only one option is given", async () => {
      // interval 5分 のみ指定、duration はデフォルト 360分 → 73個 > 25
      const response = await dispatch(
        buildCommandInteraction(
          "schedule",
          "create",
          [
            { name: "post_time", value: "20:00" },
            { name: "interval", value: 5, type: 4 },
          ],
          { guildId: "test-guild", channelId: "test-channel", userId: "test-user" },
        ),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("25");
      expect(await db.select().from(schema.schedules).all()).toHaveLength(0);
    });

    it("should create at the 25-option boundary (23h / 60min + 未定 = 25)", async () => {
      // interval 60分 / duration 1380分 → 24スロット + 「未定」= 25個 (境界, 許可)
      await dispatch(
        buildCommandInteraction(
          "schedule",
          "create",
          [
            { name: "post_time", value: "20:00" },
            { name: "interval", value: 60, type: 4 },
            { name: "duration", value: 1380, type: 4 },
          ],
          { guildId: "test-guild", channelId: "test-channel", userId: "test-user" },
        ),
      );

      expect(await db.select().from(schema.schedules).all()).toHaveLength(1);
    });

    it("should reject just over the boundary (24h / 60min + 未定 = 26)", async () => {
      // interval 60分 / duration 1440分 → 25スロット + 「未定」= 26個 > 25 (拒否)
      const response = await dispatch(
        buildCommandInteraction(
          "schedule",
          "create",
          [
            { name: "post_time", value: "20:00" },
            { name: "interval", value: 60, type: 4 },
            { name: "duration", value: 1440, type: 4 },
          ],
          { guildId: "test-guild", channelId: "test-channel", userId: "test-user" },
        ),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("25");
      expect(await db.select().from(schema.schedules).all()).toHaveLength(0);
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

    it("should reject deletion by a non-creator without manage permissions", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response),
      );

      const scheduleId = "sched-2";
      await insertSchedule(scheduleId, { creatorId: "owner-user" });

      const response = await dispatch(
        buildCommandInteraction("schedule", "delete", [{ name: "id", value: scheduleId }], {
          guildId: "test-guild",
          userId: "different-user",
          permissions: PermissionFlagsBits.SendMessages.toString(),
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain(
        "権限がありません",
      );
      // 削除されず残っていること
      expect(await db.select().from(schema.schedules).all()).toHaveLength(1);
    });

    it("should allow deletion by a non-creator who has ManageGuild", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response),
      );

      const scheduleId = "sched-2b";
      await insertSchedule(scheduleId, { creatorId: "owner-user" });

      const response = await dispatch(
        buildCommandInteraction("schedule", "delete", [{ name: "id", value: scheduleId }], {
          guildId: "test-guild",
          userId: "admin-user",
          permissions: PermissionFlagsBits.ManageGuild.toString(),
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
      expect(content).toContain("delete");
      expect(content).toContain("list");

      const accounts = await db.select().from(schema.riotAccounts).all();
      expect(accounts).toHaveLength(0);
    });
  });

  describe("/riot delete", () => {
    const insertAccount = (userId: string, gameName: string, tagLine: string) =>
      db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
        createdAtUtc: new Date().toISOString(),
        lastFetchedAtUtc: new Date().toISOString(),
      });

    it("should delete only the specified account (名前#タグ)", async () => {
      const userId = "test-user";
      await insertAccount(userId, "Player1", "123");
      await insertAccount(userId, "Player2", "456");

      const response = await dispatch(
        buildCommandInteraction("riot", "delete", [{ name: "game_name", value: "Player1#123" }], {
          userId,
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain("Player1#123");

      const remaining = await db
        .select()
        .from(schema.riotAccounts)
        .where(eq(schema.riotAccounts.userId, userId))
        .all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.gameName).toBe("Player2");
    });

    it("should delete all accounts with the sentinel value", async () => {
      const userId = "test-user";
      await insertAccount(userId, "Player1", "123");
      await insertAccount(userId, "Player2", "456");

      const response = await dispatch(
        buildCommandInteraction("riot", "delete", [{ name: "game_name", value: "__ALL__" }], {
          userId,
        }),
      );

      expect((response as { data?: { content?: string } }).data?.content).toContain(
        "全てのアカウントを削除しました",
      );

      const remaining = await db
        .select()
        .from(schema.riotAccounts)
        .where(eq(schema.riotAccounts.userId, userId))
        .all();
      expect(remaining).toHaveLength(0);
    });

    it("should not delete accounts of other users", async () => {
      await insertAccount("user1", "Player1", "123");
      await insertAccount("user2", "Player1", "123");

      await dispatch(
        buildCommandInteraction("riot", "delete", [{ name: "game_name", value: "__ALL__" }], {
          userId: "user1",
        }),
      );

      const others = await db
        .select()
        .from(schema.riotAccounts)
        .where(eq(schema.riotAccounts.userId, "user2"))
        .all();
      expect(others).toHaveLength(1);
    });
  });

  describe("handleAutocomplete - /riot delete", () => {
    const buildAutocompleteInteraction = (
      commandName: string,
      subName: string,
      ctxIds: { userId?: string; guildId?: string } = {},
    ) =>
      ({
        type: 4,
        id: "interaction-id",
        application_id: "test-app-id",
        token: "interaction-token",
        guild_id: ctxIds.guildId,
        member: ctxIds.userId ? { user: { id: ctxIds.userId } } : undefined,
        data: {
          id: "cmd-id",
          name: commandName,
          type: 1,
          options: [{ type: 1, name: subName, options: [] }],
        },
      }) as unknown as Parameters<typeof handleAutocomplete>[0];

    it("should suggest 全て削除 first, then the user's accounts", async () => {
      const userId = "test-user";
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName: "Player1",
        tagLine: "123",
        region: "ap",
        rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
        createdAtUtc: new Date().toISOString(),
        lastFetchedAtUtc: new Date().toISOString(),
      });

      const response = await handleAutocomplete(
        buildAutocompleteInteraction("riot", "delete", { userId }),
        env,
      );

      const choices =
        (response as { data?: { choices?: { name: string; value: string }[] } }).data?.choices ??
        [];
      expect(choices[0]).toEqual({ name: "全て削除", value: "__ALL__" });
      expect(choices).toContainEqual({ name: "Player1#123 (Gold 2)", value: "Player1#123" });
    });

    it("should only suggest the requesting user's accounts", async () => {
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId: "other-user",
        gameName: "OtherPlayer",
        tagLine: "999",
        region: "ap",
        rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
        createdAtUtc: new Date().toISOString(),
        lastFetchedAtUtc: new Date().toISOString(),
      });

      const response = await handleAutocomplete(
        buildAutocompleteInteraction("riot", "delete", { userId: "test-user" }),
        env,
      );

      const choices =
        (response as { data?: { choices?: { name: string; value: string }[] } }).data?.choices ??
        [];
      // 全て削除のみ（他人のアカウントは含まれない）
      expect(choices).toHaveLength(1);
      expect(choices[0]?.value).toBe("__ALL__");
    });
  });
});
