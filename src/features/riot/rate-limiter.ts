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
  const now = Date.now();
  const nowUtc = new Date(now).toISOString();
  const windowStartUtc = new Date(now - windowMs).toISOString();
  const id = crypto.randomUUID();

  // ウィンドウ外の古いレコードを削除（カウント対象から除外）
  await db
    .delete(apiRateLimits)
    .where(
      and(
        eq(apiRateLimits.apiName, "henrikdev"),
        sql`${apiRateLimits.requestedAtUtc} < ${windowStartUtc}`,
      ),
    );

  // カウントと挿入を単一の条件付き INSERT にまとめ、競合窓を最小化する。
  // 別個の SELECT(count) → INSERT では、その間に並行リクエストが割り込むと
  // 両者が「上限未満」と判断して上限超過し得る。INSERT ... SELECT ... WHERE で
  // カウント判定と挿入を1文にすることで割り込み余地を大幅に減らす。
  // 注: D1 にはトランザクションがないため完全な原子性は保証されない（25/分の
  //     安全マージンで上限30に対する超過を吸収する設計のまま）。
  const insertResult = await db.run(sql`
    INSERT INTO api_rate_limits (id, api_name, requested_at_utc)
    SELECT ${id}, 'henrikdev', ${nowUtc}
    WHERE (
      SELECT COUNT(*) FROM api_rate_limits
      WHERE api_name = 'henrikdev' AND requested_at_utc >= ${windowStartUtc}
    ) < ${limit}
  `);

  const inserted = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;

  if (inserted > 0) {
    const countRow = await db
      .select({ count: sql<number>`count(*)` })
      .from(apiRateLimits)
      .where(
        and(
          eq(apiRateLimits.apiName, "henrikdev"),
          sql`${apiRateLimits.requestedAtUtc} >= ${windowStartUtc}`,
        ),
      )
      .get();

    const currentCount = Number(countRow?.count ?? 0);
    return {
      allowed: true,
      remainingRequests: Math.max(0, limit - currentCount),
    };
  }

  // 上限到達: ウィンドウ内の最古リクエストから待機時間を算出
  const oldest = await db
    .select({ requestedAtUtc: apiRateLimits.requestedAtUtc })
    .from(apiRateLimits)
    .where(
      and(
        eq(apiRateLimits.apiName, "henrikdev"),
        sql`${apiRateLimits.requestedAtUtc} >= ${windowStartUtc}`,
      ),
    )
    .orderBy(apiRateLimits.requestedAtUtc)
    .limit(1)
    .get();

  const waitTimeMs = oldest
    ? Math.max(0, new Date(oldest.requestedAtUtc).getTime() + windowMs - now)
    : windowMs;

  return {
    allowed: false,
    remainingRequests: 0,
    waitTimeMs,
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
