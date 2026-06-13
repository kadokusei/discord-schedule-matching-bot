import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { apiRateLimits } from "../../db/schema";
import type * as schema from "../../db/schema";

// HenrikDev の上限は 30 req/min だが、D1 ベースのカウントは非アトミックで
// 同時実行時に超過し得るため、安全マージンを取り 25 に下げる。
const HENRIKDEV_RATE_LIMIT = 25; // requests per minute (safety margin under 30)
const RATE_LIMIT_WINDOW_MIN = 1;

interface RateLimitCheckResult {
  allowed: boolean;
  remainingRequests: number;
  waitTimeMs?: number;
}

const recordRequestWithLimitCheck = async (
  db: DrizzleD1Database<typeof schema>,
  limit: number,
  windowMs: number,
): Promise<RateLimitCheckResult> => {
  const nowUtc = new Date().toISOString();
  const windowStartUtc = new Date(Date.now() - windowMs).toISOString();

  await db
    .delete(apiRateLimits)
    .where(
      and(
        eq(apiRateLimits.apiName, "henrikdev"),
        sql`${apiRateLimits.requestedAtUtc} < ${windowStartUtc}`,
      ),
    );

  const recentRequests = await db
    .select()
    .from(apiRateLimits)
    .where(eq(apiRateLimits.apiName, "henrikdev"));

  const currentCount = recentRequests.length;

  if (currentCount >= limit) {
    const oldestRequest = recentRequests.sort(
      (a, b) => new Date(a.requestedAtUtc).getTime() - new Date(b.requestedAtUtc).getTime(),
    )[0];

    const expireTime = new Date(oldestRequest.requestedAtUtc).getTime() + windowMs;
    const waitTimeMs = Math.max(0, expireTime - Date.now());

    return {
      allowed: false,
      remainingRequests: 0,
      waitTimeMs,
    };
  }

  await db.insert(apiRateLimits).values({
    id: crypto.randomUUID(),
    apiName: "henrikdev",
    requestedAtUtc: nowUtc,
  });

  return {
    allowed: true,
    remainingRequests: limit - currentCount - 1,
  };
};

export class RateLimiter {
  constructor(private db: DrizzleD1Database<typeof schema>) {}

  async checkRateLimit(): Promise<RateLimitCheckResult> {
    return recordRequestWithLimitCheck(
      this.db,
      HENRIKDEV_RATE_LIMIT,
      RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    );
  }
}
