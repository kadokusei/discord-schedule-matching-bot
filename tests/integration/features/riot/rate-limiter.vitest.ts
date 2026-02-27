import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../../src/db/schema";
import { RateLimiter } from "../../../../src/features/riot";

describe("RateLimiter", () => {
  const db = drizzle(env.DB, { schema });

  beforeEach(async () => {
    // Clean up before each test
    await db.delete(schema.apiRateLimits);
  });

  describe("checkRateLimit", () => {
    it("should allow requests when under rate limit", async () => {
      const limiter = new RateLimiter(db);
      const result = await limiter.checkRateLimit();

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(29); // 30 - 1 (already recorded)
    });

    it("should decrease remaining requests after each call", async () => {
      const limiter = new RateLimiter(db);

      // Call checkRateLimit 5 times (each records a request)
      for (let i = 0; i < 5; i++) {
        await limiter.checkRateLimit();
      }

      const result = await limiter.checkRateLimit();
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(24); // 30 - 6 (5 + 1 current)
    });

    it("should block requests when rate limit exceeded", async () => {
      const limiter = new RateLimiter(db);

      // Call checkRateLimit 30 times
      for (let i = 0; i < 30; i++) {
        await limiter.checkRateLimit();
      }

      const result = await limiter.checkRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.waitTimeMs).toBeGreaterThan(0);
      expect(result.waitTimeMs).toBeLessThanOrEqual(60000);
    });

    // Skipped: requires 61s real-time wait. To enable, inject a clock into RateLimiter.
    it.skip("should clean up old requests outside the rate limit window", async () => {
      const limiter = new RateLimiter(db);

      // Call checkRateLimit 30 times
      for (let i = 0; i < 30; i++) {
        await limiter.checkRateLimit();
      }

      // Should be rate limited
      const rateLimitedResult = await limiter.checkRateLimit();
      expect(rateLimitedResult.allowed).toBe(false);

      // Wait for the rate limit window to expire (61 seconds)
      await new Promise((resolve) => setTimeout(resolve, 61000));

      // Should now be allowed
      const allowedResult = await limiter.checkRateLimit();
      expect(allowedResult.allowed).toBe(true);
      expect(allowedResult.remainingRequests).toBe(29);
    });
  });
});
