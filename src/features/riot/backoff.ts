/**
 * HenrikDev レートリミット対処のための純粋関数群。
 *
 * すべて副作用を持たず、現在時刻(nowMs)・乱数(rng)は引数注入する。
 * これによりリトライ・バックオフ・cooldown の判定をテストで決定論化できる。
 */

/** 追加リトライの最大回数（最初の試行は含めない。合計試行数 = MAX_RETRIES + 1） */
export const MAX_RETRIES = 2;
/** attempt ごとの指数バックオフ基準値(ms)。範囲外は末尾値を流用する。 */
export const RETRY_BASE_DELAYS_MS = [1000, 2000] as const;
/** リトライ全体の総待機予算(ms)。これを超える待機は打ち切り、積み上げを防ぐ。 */
export const RETRY_TIME_BUDGET_MS = 5000;
/** global limit（API 全体の制限）に達したときの cooldown(ms)。 */
export const COOLDOWN_MS = 30_000;
/** personal limit（共有鍵の枠を使い切った）ときの cooldown(ms)。回復に時間がかかるため長め。 */
export const COOLDOWN_MS_PERSONAL = 60_000;

/**
 * Retry-After ヘッダ値をミリ秒に変換する。
 * - 数値（秒）形式: "30" → 30000
 * - HTTP-date 形式: now との差分（過去なら 0 にクランプ）
 * - null / 不正値: undefined（HenrikDev は Retry-After を保証しないため、呼び出し側で fallback）
 */
export const parseRetryAfter = (headerValue: string | null, nowMs: number): number | undefined => {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed === "") return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }

  return undefined;
};

/**
 * 次のリトライまでの待機時間(ms)を返す。これ以上リトライすべきでなければ null。
 *
 * @param attempt 既に消費したリトライ回数（0 = まだリトライしていない）
 * @param retryAfterMs Retry-After 由来の待機指示（なければ undefined）
 * @param budgetRemainingMs 総待機予算の残り(ms)
 * @param rng ジッタ用の乱数 [0,1)。テストでは固定値を注入する
 */
export const nextBackoffMs = (
  attempt: number,
  retryAfterMs: number | undefined,
  budgetRemainingMs: number,
  rng: () => number,
): number | null => {
  if (attempt >= MAX_RETRIES) return null;
  if (budgetRemainingMs <= 0) return null;

  const base =
    retryAfterMs ??
    RETRY_BASE_DELAYS_MS[attempt] ??
    RETRY_BASE_DELAYS_MS[RETRY_BASE_DELAYS_MS.length - 1];

  // Retry-After 指示があるときは尊重しジッタを加えない。指示がないときのみ ±20% ジッタ。
  const jittered = retryAfterMs === undefined ? base * (0.8 + 0.4 * rng()) : base;
  const delay = Math.round(jittered);

  // 予算を超える待機は打ち切る（リトライ無限積み上げ防止の第一防衛線）。
  if (delay > budgetRemainingMs) return null;
  return delay;
};

/** cooldown 解除時刻(ms)を過ぎていれば true（= 実 API を叩いてよい）。null は記録なし。 */
export const isCooldownExpired = (untilMs: number | null, nowMs: number): boolean => {
  if (untilMs === null) return true;
  return nowMs >= untilMs;
};

/**
 * 429 のスコープと現在時刻から cooldown 解除時刻(ms)を算出する。
 * personal limit は長めに取り、Retry-After が base より長ければそれを採用する。
 */
export const computeCooldownUntil = (
  scope: "personal" | "global" | undefined,
  retryAfterMs: number | undefined,
  nowMs: number,
): number => {
  const base = scope === "personal" ? COOLDOWN_MS_PERSONAL : COOLDOWN_MS;
  const duration = retryAfterMs !== undefined ? Math.max(base, retryAfterMs) : base;
  return nowMs + duration;
};
