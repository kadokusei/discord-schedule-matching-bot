import { env } from "cloudflare:test";
import type { CommandContext } from "discord-hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import type { Env } from "../../../src/lib/types";

type MockCommandContext = Partial<CommandContext<{ Bindings: Env }>>;

describe("Command Handlers - Integration Tests", () => {
  const db = drizzle(env.DB, { schema });

  beforeEach(async () => {
    await db.delete(schema.schedules);
    await db.delete(schema.guildSettings);
    await db.delete(schema.riotAccounts);
    vi.clearAllMocks();
  });

  describe("handlerScheduleRecruit", () => {
    it("should create schedule with provided options", async () => {
      const { handlerScheduleRecruit } = await import("../../../src/handlers/commands");

      const mockContext: MockCommandContext = {
        interaction: {
          guild_id: "test-guild",
          channel_id: "test-channel",
          member: { user: { id: "test-user" } },
          data: {
            options: [
              { name: "post_time", value: "20:00" },
              { name: "interval", value: 60 },
              { name: "duration", value: 180 },
            ],
          },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerScheduleRecruit(mockContext as CommandContext<{ Bindings: Env }>);

      const schedules = await db.select().from(schema.schedules).all();
      expect(schedules).toHaveLength(1);
      expect(schedules[0]?.postTimeHHmm).toBe("20:00");
      expect(schedules[0]?.intervalMin).toBe(60);
      expect(schedules[0]?.durationMin).toBe(180);
    });

    it("should use default settings when options not provided", async () => {
      const { handlerScheduleRecruit } = await import("../../../src/handlers/commands");

      await db.insert(schema.guildSettings).values({
        id: crypto.randomUUID(),
        guildId: "test-guild",
        timezone: "Asia/Tokyo",
        defaultIntervalMin: 45,
        defaultDurationMin: 240,
      });

      const mockContext: MockCommandContext = {
        interaction: {
          guild_id: "test-guild",
          channel_id: "test-channel",
          member: { user: { id: "test-user" } },
          data: {
            options: [{ name: "post_time", value: "21:00" }],
          },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerScheduleRecruit(mockContext as CommandContext<{ Bindings: Env }>);

      const schedules = await db.select().from(schema.schedules).all();
      expect(schedules[0]?.intervalMin).toBe(45);
      expect(schedules[0]?.durationMin).toBe(240);
    });

    it("should return error for invalid time format", async () => {
      const { handlerScheduleRecruit } = await import("../../../src/handlers/commands");

      const mockContext: MockCommandContext = {
        interaction: {
          guild_id: "test-guild",
          channel_id: "test-channel",
          member: { user: { id: "test-user" } },
          data: {
            options: [{ name: "post_time", value: "invalid" }],
          },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerScheduleRecruit(mockContext as CommandContext<{ Bindings: Env }>);

      expect(mockContext.res).toHaveBeenCalledWith(expect.stringContaining("エラー"));
    });
  });

  describe("handlerScheduleSettings", () => {
    it("should update timezone for existing guild", async () => {
      const { handlerScheduleSettings } = await import("../../../src/handlers/commands");

      const existingId = crypto.randomUUID();
      await db.insert(schema.guildSettings).values({
        id: existingId,
        guildId: "test-guild",
        timezone: "America/New_York",
      });

      const mockContext: MockCommandContext = {
        interaction: {
          guild_id: "test-guild",
          data: {
            options: [{ name: "timezone", value: "Asia/Tokyo" }],
          },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerScheduleSettings(mockContext as CommandContext<{ Bindings: Env }>);

      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();

      expect(settings?.timezone).toBe("Asia/Tokyo");
      expect(settings?.id).toBe(existingId);
    });

    it("should create new settings for new guild", async () => {
      const { handlerScheduleSettings } = await import("../../../src/handlers/commands");

      const mockContext: MockCommandContext = {
        interaction: {
          guild_id: "test-guild",
          data: {
            options: [{ name: "timezone", value: "UTC" }],
          },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerScheduleSettings(mockContext as CommandContext<{ Bindings: Env }>);

      const settings = await db
        .select()
        .from(schema.guildSettings)
        .where(eq(schema.guildSettings.guildId, "test-guild"))
        .get();

      expect(settings?.timezone).toBe("UTC");
    });
  });

  describe("handlerRiotAccountList", () => {
    it("should return empty message when no accounts", async () => {
      const { handlerRiotAccountList } = await import("../../../src/handlers/commands");

      const mockContext: MockCommandContext = {
        interaction: {
          member: { user: { id: "test-user" } },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerRiotAccountList(mockContext as CommandContext<{ Bindings: Env }>);

      expect(mockContext.res).toHaveBeenCalledWith("登録されているアカウントはありません");
    });

    it("should list all user accounts", async () => {
      const { handlerRiotAccountList } = await import("../../../src/handlers/commands");

      const userId = "test-user";
      await db.insert(schema.riotAccounts).values([
        {
          id: crypto.randomUUID(),
          userId,
          gameName: "Player1",
          tagLine: "123",
          region: "na",
          rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          userId,
          gameName: "Player2",
          tagLine: "456",
          region: "na",
          rank: JSON.stringify({ tier: 15, division: "1", rank: "Platinum 1" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
      ]);

      const mockContext: MockCommandContext = {
        interaction: {
          member: { user: { id: userId } },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerRiotAccountList(mockContext as CommandContext<{ Bindings: Env }>);

      expect(mockContext.res).toHaveBeenCalledWith(expect.stringContaining("Player1#123"));
      expect(mockContext.res).toHaveBeenCalledWith(expect.stringContaining("Player2#456"));
    });

    it("should return only accounts for the requesting user", async () => {
      const { handlerRiotAccountList } = await import("../../../src/handlers/commands");

      const user1 = "user1";
      const user2 = "user2";

      await db.insert(schema.riotAccounts).values([
        {
          id: crypto.randomUUID(),
          userId: user1,
          gameName: "Player1",
          tagLine: "123",
          region: "na",
          rank: JSON.stringify({ tier: 10, division: "2", rank: "Gold 2" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          userId: user2,
          gameName: "Player2",
          tagLine: "456",
          region: "na",
          rank: JSON.stringify({ tier: 15, division: "1", rank: "Platinum 1" }),
          createdAtUtc: new Date().toISOString(),
          lastFetchedAtUtc: new Date().toISOString(),
        },
      ]);

      const mockContext: MockCommandContext = {
        interaction: {
          member: { user: { id: user1 } },
        } as never,
        env: {
          DB: env.DB,
          HENRIKDEV_API_KEY: "test-key",
          DISCORD_PUBLIC_KEY: "test",
          DISCORD_BOT_TOKEN: "test",
        },
        res: vi.fn() as never,
      };

      await handlerRiotAccountList(mockContext as CommandContext<{ Bindings: Env }>);

      expect(mockContext.res).toHaveBeenCalledWith(expect.stringContaining("Player1#123"));
      expect(mockContext.res).not.toHaveBeenCalledWith(expect.stringContaining("Player2#456"));
    });
  });
});
