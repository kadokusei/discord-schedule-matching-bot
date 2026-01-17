import { env } from "cloudflare:test";
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as schema from "../../../../src/db/schema";
import {
  fetchValorantRankWithCache,
  type ValorantRank,
} from "../../../../src/features/riot";

// Mock fetch for HenrikDev API
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const mockRankData: ValorantRank = {
  tier: 28,
  division: "2",
  rank: "Radiant 2",
};

const mockHenrikResponse = {
  data: {
    account: {
      name: "TestPlayer",
      tag: "1234",
    },
    current: {
      tier: {
        id: 28,
        name: "Radiant 2",
      },
    },
  },
};

describe("fetchValorantRankWithCache", () => {
  const db = drizzle(env.DB, { schema });
  const gameName = "TestPlayer";
  const tagLine = "1234";
  const userId = "test-user-id";
  const apiKey = env.HENRIKDEV_API_KEY;

  beforeAll(async () => {
    // Create tables
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS riot_accounts (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          game_name TEXT NOT NULL,
          tag_line TEXT NOT NULL,
          region TEXT DEFAULT 'na' NOT NULL,
          rank TEXT NOT NULL,
          created_at_utc TEXT NOT NULL,
          last_fetched_at_utc TEXT NOT NULL,
          UNIQUE(user_id, game_name, tag_line)
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS api_rate_limits (
          id TEXT PRIMARY KEY NOT NULL,
          api_name TEXT NOT NULL,
          requested_at_utc TEXT NOT NULL
        )
      `),
    ]);
  });

  beforeEach(async () => {
    // Clean up before each test
    await db.delete(schema.riotAccounts);
    await db.delete(schema.apiRateLimits);
    vi.clearAllMocks();
  });

  describe("cache behavior", () => {
    it("should fetch from API when no cache exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHenrikResponse,
      } as Response);

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(true);
      expect(result.account?.rank).toEqual(mockRankData);
      expect(result.fromCache).toBe(false);
      expect(result.remainingRequests).toBe(29);

      // Verify database entry was created
      const accounts = await db.select().from(schema.riotAccounts).all();
      expect(accounts.length).toBe(1);
      expect(accounts[0]?.gameName).toBe(gameName);
      expect(accounts[0]?.tagLine).toBe(tagLine);
    });

    it("should use cache when within 24 hour window", async () => {
      // First, create a cached entry
      const nowUtc = new Date().toISOString();
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify(mockRankData),
        createdAtUtc: nowUtc,
        lastFetchedAtUtc: nowUtc,
      });

      // Fetch without calling API
      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(true);
      expect(result.account?.rank).toEqual(mockRankData);
      expect(result.fromCache).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should fetch from API when cache is expired (24 hours)", async () => {
      // Create a cached entry that's 25 hours old
      const expiredUtc = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString();
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify(mockRankData),
        createdAtUtc: expiredUtc,
        lastFetchedAtUtc: expiredUtc,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHenrikResponse,
      } as Response);

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should use shorter cache (5 minutes) when isJoining is true", async () => {
      // Create a cached entry that's 6 minutes old (expired for joining)
      const sixMinAgoUtc = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify(mockRankData),
        createdAtUtc: sixMinAgoUtc,
        lastFetchedAtUtc: sixMinAgoUtc,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHenrikResponse,
      } as Response);

      // With isJoining: true, 6 minute old cache should be expired
      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
        { isJoining: true },
      );

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should use cache within 5 minutes when isJoining is true", async () => {
      // Create a cached entry that's 4 minutes old (valid for joining)
      const fourMinAgoUtc = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify(mockRankData),
        createdAtUtc: fourMinAgoUtc,
        lastFetchedAtUtc: fourMinAgoUtc,
      });

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
        { isJoining: true },
      );

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("API failure handling", () => {
    it("should fallback to stale cache on API error", async () => {
      // Create a cached entry
      const nowUtc = new Date().toISOString();
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify(mockRankData),
        createdAtUtc: nowUtc,
        lastFetchedAtUtc: nowUtc,
      });

      // Mock API error (expired cache)
      const expiredUtc = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString();
      await db
        .update(schema.riotAccounts)
        .set({ lastFetchedAtUtc: expiredUtc })
        .where(sql`1=1`);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(true);
      expect(result.account?.rank).toEqual(mockRankData);
      expect(result.fromCache).toBe(true);
    });

    it("should return error when API fails and no cache exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      } as Response);

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  describe("rate limit handling", () => {
    it("should fallback to cache when rate limited", async () => {
      // Create a cached entry
      const nowUtc = new Date().toISOString();
      await db.insert(schema.riotAccounts).values({
        id: crypto.randomUUID(),
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify(mockRankData),
        createdAtUtc: nowUtc,
        lastFetchedAtUtc: nowUtc,
      });

      // Expire the cache
      const expiredUtc = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString();
      await db
        .update(schema.riotAccounts)
        .set({ lastFetchedAtUtc: expiredUtc })
        .where(sql`1=1`);

      // Fill rate limit (30 requests)
      const { RateLimiter } = await import("../../../../src/features/riot");
      const limiter = new RateLimiter(db);
      for (let i = 0; i < 30; i++) {
        await limiter.recordRequest();
      }

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(true);
      expect(result.account?.rank).toEqual(mockRankData);
      expect(result.fromCache).toBe(true);
    });

    it("should return rate limit error when rate limited and no cache", async () => {
      // Fill rate limit (30 requests)
      const { RateLimiter } = await import("../../../../src/features/riot");
      const limiter = new RateLimiter(db);
      for (let i = 0; i < 30; i++) {
        await limiter.recordRequest();
      }

      const result = await fetchValorantRankWithCache(
        gameName,
        tagLine,
        userId,
        db,
        apiKey,
      );

      expect(result.success).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.error).toContain("Rate limit exceeded");
    });
  });

  describe("upsert behavior", () => {
    it("should create new entry on first fetch", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHenrikResponse,
      } as Response);

      await fetchValorantRankWithCache(gameName, tagLine, userId, db, apiKey);

      const accounts = await db.select().from(schema.riotAccounts).all();

      expect(accounts.length).toBe(1);
      expect(accounts[0]?.gameName).toBe(gameName);
      expect(accounts[0]?.tagLine).toBe(tagLine);
    });

    it("should update existing entry on subsequent fetch", async () => {
      // Create initial entry
      const nowUtc = new Date().toISOString();
      const accountId = crypto.randomUUID();
      await db.insert(schema.riotAccounts).values({
        id: accountId,
        userId,
        gameName,
        tagLine,
        region: "ap",
        rank: JSON.stringify({ tier: 0, division: "1", rank: "Iron 1" }),
        createdAtUtc: nowUtc,
        lastFetchedAtUtc: nowUtc,
      });

      // Expire the cache
      const expiredUtc = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString();
      await db
        .update(schema.riotAccounts)
        .set({ lastFetchedAtUtc: expiredUtc })
        .where(sql`1=1`);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHenrikResponse,
      } as Response);

      await fetchValorantRankWithCache(gameName, tagLine, userId, db, apiKey);

      const accounts = await db.select().from(schema.riotAccounts).all();

      expect(accounts.length).toBe(1);
      expect(accounts[0]?.id).toBe(accountId);
      expect(accounts[0]?.rank).toContain("Radiant");
    });
  });
});
