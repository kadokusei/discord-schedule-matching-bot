import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { apiRateLimits } from "../../db/schema";
import type * as schema from "../../db/schema";

// 事前カウント方式（30 req/min の厳密管理）は撤廃し、429 をリアクティブに検知して
// リトライ + cooldown で対処する。cooldown 状態は既存の api_rate_limits テーブルを転用して保持する。
//
// 転用の約束: api_name = 'henrikdev_cooldown' の 1 行のみを使い、その requested_at_utc を
// 「cooldown 解除時刻(ISO)」として再解釈する（リクエスト時刻ではない）。id も固定値にして
// 単一行・最後勝ち（last-write-wins）で上書きする。従来のカウント用 'henrikdev' 行は使わない。
const COOLDOWN_API_NAME = "henrikdev_cooldown";

/** 現在の cooldown 解除時刻(ms)を返す。記録がなければ null。 */
export const readCooldownUntilMs = async (
  db: DrizzleD1Database<typeof schema>,
): Promise<number | null> => {
  const row = await db
    .select({ requestedAtUtc: apiRateLimits.requestedAtUtc })
    .from(apiRateLimits)
    .where(eq(apiRateLimits.apiName, COOLDOWN_API_NAME))
    .get();

  if (!row) return null;
  const ms = new Date(row.requestedAtUtc).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * cooldown 解除時刻(ms)を記録する。
 * 固定 id の単一行を upsert し、最新の解除時刻で上書きする（同時多発でも最後勝ちで整合）。
 */
export const writeCooldownUntil = async (
  db: DrizzleD1Database<typeof schema>,
  untilMs: number,
): Promise<void> => {
  const untilUtc = new Date(untilMs).toISOString();
  await db
    .insert(apiRateLimits)
    .values({
      id: COOLDOWN_API_NAME,
      apiName: COOLDOWN_API_NAME,
      requestedAtUtc: untilUtc,
    })
    .onConflictDoUpdate({
      target: apiRateLimits.id,
      set: { requestedAtUtc: untilUtc },
    });
};
