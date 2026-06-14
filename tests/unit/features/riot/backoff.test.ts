import { describe, expect, it } from "vitest";
import {
  COOLDOWN_MS,
  COOLDOWN_MS_PERSONAL,
  MAX_RETRIES,
  RETRY_TIME_BUDGET_MS,
  computeCooldownUntil,
  isCooldownExpired,
  nextBackoffMs,
  parseRetryAfter,
} from "../../../../src/features/riot/backoff";

describe("parseRetryAfter", () => {
  const nowMs = 1_000_000;

  it("数値（秒）形式をミリ秒に変換する", () => {
    expect(parseRetryAfter("30", nowMs)).toBe(30_000);
    expect(parseRetryAfter("0", nowMs)).toBe(0);
  });

  it("前後の空白を許容する", () => {
    expect(parseRetryAfter("  5 ", nowMs)).toBe(5_000);
  });

  it("HTTP-date 形式を now との差分(ms)に変換する", () => {
    const future = new Date(nowMs + 10_000).toUTCString();
    expect(parseRetryAfter(future, nowMs)).toBe(10_000);
  });

  it("過去の HTTP-date は 0 にクランプする", () => {
    const past = new Date(nowMs - 10_000).toUTCString();
    expect(parseRetryAfter(past, nowMs)).toBe(0);
  });

  it("null / 不正値は undefined（呼び出し側で fallback）", () => {
    expect(parseRetryAfter(null, nowMs)).toBeUndefined();
    expect(parseRetryAfter("", nowMs)).toBeUndefined();
    expect(parseRetryAfter("not-a-date", nowMs)).toBeUndefined();
  });
});

describe("nextBackoffMs", () => {
  const fixedRng = () => 0.5; // ジッタを base 等倍に固定

  it("attempt ごとに指数的に増える（rng=0.5 で base 等倍）", () => {
    expect(nextBackoffMs(0, undefined, RETRY_TIME_BUDGET_MS, fixedRng)).toBe(1000);
    expect(nextBackoffMs(1, undefined, RETRY_TIME_BUDGET_MS, fixedRng)).toBe(2000);
  });

  it("Retry-After があればジッタなしでそれを優先する", () => {
    expect(nextBackoffMs(0, 1500, RETRY_TIME_BUDGET_MS, fixedRng)).toBe(1500);
  });

  it("最大リトライ回数に達したら null", () => {
    expect(nextBackoffMs(MAX_RETRIES, undefined, RETRY_TIME_BUDGET_MS, fixedRng)).toBeNull();
  });

  it("総待機予算を超える待機は打ち切り（null）", () => {
    expect(nextBackoffMs(0, 9999, 500, fixedRng)).toBeNull();
    expect(nextBackoffMs(0, undefined, 0, fixedRng)).toBeNull();
  });

  it("ジッタは ±20% の範囲に収まる", () => {
    const low = nextBackoffMs(0, undefined, RETRY_TIME_BUDGET_MS, () => 0);
    const high = nextBackoffMs(0, undefined, RETRY_TIME_BUDGET_MS, () => 0.999);
    expect(low).toBe(800);
    expect(high).toBeGreaterThan(1100);
    expect(high).toBeLessThanOrEqual(1200);
  });
});

describe("isCooldownExpired", () => {
  it("記録なし（null）は常に true", () => {
    expect(isCooldownExpired(null, 1000)).toBe(true);
  });

  it("解除時刻を過ぎていれば true、未来なら false", () => {
    expect(isCooldownExpired(1000, 1000)).toBe(true);
    expect(isCooldownExpired(1000, 1001)).toBe(true);
    expect(isCooldownExpired(2000, 1999)).toBe(false);
  });
});

describe("computeCooldownUntil", () => {
  const nowMs = 1_000_000;

  it("global は COOLDOWN_MS を加える", () => {
    expect(computeCooldownUntil("global", undefined, nowMs)).toBe(nowMs + COOLDOWN_MS);
  });

  it("personal（共有鍵枯渇）は長めの COOLDOWN_MS_PERSONAL", () => {
    expect(computeCooldownUntil("personal", undefined, nowMs)).toBe(nowMs + COOLDOWN_MS_PERSONAL);
  });

  it("Retry-After が base より長ければそれを採用する", () => {
    const longRetry = COOLDOWN_MS_PERSONAL + 10_000;
    expect(computeCooldownUntil("global", longRetry, nowMs)).toBe(nowMs + longRetry);
  });

  it("scope 未指定は global 扱い", () => {
    expect(computeCooldownUntil(undefined, undefined, nowMs)).toBe(nowMs + COOLDOWN_MS);
  });
});
