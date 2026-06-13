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
    await db.delete(schema.schedules);
    await db.delete(schema.guildSettings);
    await db.delete(schema.riotAccounts);
    vi.clearAllMocks();
  });

  describe("/schedule recruit", () => {
    it("should create schedule with provided options", async () => {
      await dispatch(
        buildCommandInteraction(
          "schedule",
          "recruit",
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
        buildCommandInteraction("schedule", "recruit", [{ name: "post_time", value: "21:00" }], {
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
        buildCommandInteraction("schedule", "recruit", [{ name: "post_time", value: "invalid" }], {
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
});
