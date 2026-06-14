import { describe, expect, it } from "vitest";
import { buildRefreshSummary } from "../../../../src/features/riot/refresh";
import type { AccountRefreshResult } from "../../../../src/features/riot/refresh";

const updated = (name: string, tag: string, rank: string): AccountRefreshResult => ({
  gameName: name,
  tagLine: tag,
  result: {
    success: true,
    account: { name, tag, rank: { tier: 13, division: "2", rank } },
    error: null,
    fromCache: false,
  },
});

const rateLimitedWithCache = (name: string, tag: string, rank: string): AccountRefreshResult => ({
  gameName: name,
  tagLine: tag,
  // cooldown 中は fetchValorantRankWithCache が前回値(success:true, fromCache:true)を返す
  result: {
    success: true,
    account: { name, tag, rank: { tier: 13, division: "2", rank } },
    error: null,
    fromCache: true,
  },
});

const rateLimitedNoCache = (name: string, tag: string): AccountRefreshResult => ({
  gameName: name,
  tagLine: tag,
  result: {
    success: false,
    account: null,
    error: "Rate limit exceeded.",
    errorCode: "rate_limited",
  },
});

const failed = (name: string, tag: string): AccountRefreshResult => ({
  gameName: name,
  tagLine: tag,
  result: { success: false, account: null, error: "boom", errorCode: "network" },
});

describe("buildRefreshSummary", () => {
  it("全件更新成功なら件数と各ランクを表示する", () => {
    const summary = buildRefreshSummary([updated("Player", "JP1", "Gold 2")]);
    expect(summary).toContain("1件中 1件を更新しました");
    expect(summary).toContain("- Player#JP1 (Gold 2)");
  });

  it("レート制限（前回値あり）は更新件数に数えず前回値を併記する", () => {
    const summary = buildRefreshSummary([rateLimitedWithCache("Alt", "JP2", "Silver 1")]);
    expect(summary).toContain("1件中 0件を更新しました");
    expect(summary).toContain("レート制限中");
    expect(summary).toContain("Silver 1・前回値");
  });

  it("レート制限（前回値なし）は前回値なしと表示する", () => {
    const summary = buildRefreshSummary([rateLimitedNoCache("New", "JP3")]);
    expect(summary).toContain("レート制限中");
    expect(summary).toContain("前回値なし");
  });

  it("取得失敗は失敗として表示する", () => {
    const summary = buildRefreshSummary([failed("Bad", "JP4")]);
    expect(summary).toContain("- Bad#JP4 (取得失敗)");
  });

  it("混在ケースで更新件数を正しく数える", () => {
    const summary = buildRefreshSummary([
      updated("A", "1", "Gold 2"),
      rateLimitedWithCache("B", "2", "Silver 1"),
      failed("C", "3"),
    ]);
    expect(summary).toContain("3件中 1件を更新しました");
  });
});
