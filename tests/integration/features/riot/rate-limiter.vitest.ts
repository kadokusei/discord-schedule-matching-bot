import { env } from "cloudflare:test";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../src/db/schema";
import { RateLimiter } from "../../../../src/features/riot";

describe("RateLimiter", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    // Create api_rate_limits table using batch
    await env.DB.batch([
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
    await db.delete(schema.apiRateLimits);
  });

  describe("checkRateLimit", () => {
    it("should allow requests when under rate limit", async () => {
      const limiter = new RateLimiter(db);
      const result = await limiter.checkRateLimit();

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(30);
    });

    it("should decrease remaining requests after recording", async () => {
      const limiter = new RateLimiter(db);

      // Record 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.recordRequest();
      }

      const result = await limiter.checkRateLimit();
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(25);
    });

    it("should block requests when rate limit exceeded", async () => {
      const limiter = new RateLimiter(db);

      // Record 30 requests
      for (let i = 0; i < 30; i++) {
        await limiter.recordRequest();
      }

      const result = await limiter.checkRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.waitTimeMs).toBeGreaterThan(0);
      expect(result.waitTimeMs).toBeLessThanOrEqual(60000);
    });

    it.skip("should clean up old requests outside the rate limit window", async () => {
      const limiter = new RateLimiter(db);

      // Record 30 requests
      for (let i = 0; i < 30; i++) {
        await limiter.recordRequest();
      }

      // Should be rate limited
      const rateLimitedResult = await limiter.checkRateLimit();
      expect(rateLimitedResult.allowed).toBe(false);

      // Wait for the rate limit window to expire (61 seconds)
      await new Promise((resolve) => setTimeout(resolve, 61000));

      // Should now be allowed
      const allowedResult = await limiter.checkRateLimit();
      expect(allowedResult.allowed).toBe(true);
      expect(allowedResult.remainingRequests).toBe(30);
    });
  });

  describe("recordRequest", () => {
    it("should record request in database", async () => {
      const limiter = new RateLimiter(db);
      await limiter.recordRequest();

      const requests = await db.select().from(schema.apiRateLimits).all();

      expect(requests.length).toBe(1);
      expect(requests[0]?.apiName).toBe("henrikdev");
      expect(requests[0]?.requestedAtUtc).toBeTruthy();
    });

    it("should record multiple requests", async () => {
      const limiter = new RateLimiter(db);

      const recordCount = 10;
      for (let i = 0; i < recordCount; i++) {
        await limiter.recordRequest();
      }

      const requests = await db.select().from(schema.apiRateLimits).all();

      expect(requests.length).toBe(recordCount);
    });
  });
});
