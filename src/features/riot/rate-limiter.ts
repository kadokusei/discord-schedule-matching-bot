import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { apiRateLimits } from "../../db/schema";
import type * as schema from "../../db/schema";

const HENRIKDEV_RATE_LIMIT = 30; // requests per minute
const RATE_LIMIT_WINDOW_MIN = 1;

interface RateLimitCheckResult {
  allowed: boolean;
  remainingRequests: number;
  waitTimeMs?: number;
}

export class RateLimiter {
  constructor(private db: DrizzleD1Database<typeof schema>) {}

  /**
   * Checks if the API request is allowed based on rate limit
   * @returns RateLimitCheckResult with allowed status and remaining requests
   */
  async checkRateLimit(): Promise<RateLimitCheckResult> {
    const nowUtc = new Date().toISOString();
    const windowStartUtc = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    ).toISOString();

    // Clean old records and count recent requests
    await this.db
      .delete(apiRateLimits)
      .where(
        and(
          eq(apiRateLimits.apiName, "henrikdev"),
          sql`${apiRateLimits.requestedAtUtc} < ${windowStartUtc}`,
        ),
      );

    const recentRequests = await this.db
      .select()
      .from(apiRateLimits)
      .where(eq(apiRateLimits.apiName, "henrikdev"));

    const requestCount = recentRequests.length;

    if (requestCount >= HENRIKDEV_RATE_LIMIT) {
      // Calculate wait time until the oldest request expires
      const oldestRequest = recentRequests.sort(
        (a, b) =>
          new Date(a.requestedAtUtc).getTime() -
          new Date(b.requestedAtUtc).getTime(),
      )[0];
      const expireTime =
        new Date(oldestRequest.requestedAtUtc).getTime() +
        RATE_LIMIT_WINDOW_MIN * 60 * 1000;
      const waitTimeMs = expireTime - Date.now();

      return {
        allowed: false,
        remainingRequests: 0,
        waitTimeMs: Math.max(0, waitTimeMs),
      };
    }

    return {
      allowed: true,
      remainingRequests: HENRIKDEV_RATE_LIMIT - requestCount,
    };
  }

  /**
   * Records an API request
   */
  async recordRequest(): Promise<void> {
    const id = crypto.randomUUID();
    const nowUtc = new Date().toISOString();

    await this.db.insert(apiRateLimits).values({
      id,
      apiName: "henrikdev",
      requestedAtUtc: nowUtc,
    });
  }
}
