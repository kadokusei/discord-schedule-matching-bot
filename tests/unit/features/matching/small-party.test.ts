import { describe, expect, it } from "vitest";
import { type SmallPartyCandidate, findBestSmallParty } from "../../../../src/features/matching";

const candidate = (
  userId: string,
  accountRanks: string[],
  availableFromUtc = "2026-01-17T22:00:00.000Z",
  createdAtUtc = "2026-01-17T20:00:00.000Z",
): SmallPartyCandidate => ({ userId, accountRanks, availableFromUtc, createdAtUtc });

describe("findBestSmallParty", () => {
  it("成立する3人を2人より優先する", () => {
    const result = findBestSmallParty([
      candidate("a", ["Gold 1"]),
      candidate("b", ["Gold 2"]),
      candidate("c", ["Gold 3"]),
    ]);

    expect(result).not.toBeNull();
    expect(result?.size).toBe(3);
    expect(result?.memberIds).toEqual(["a", "b", "c"]);
  });

  it("複数アカウントから制限を満たす組み合わせを選ぶ", () => {
    // a は Iron と Gold を持つ。Gold アカウントを使えば Gold 帯で成立する。
    const result = findBestSmallParty([
      candidate("a", ["Iron 1", "Gold 2"]),
      candidate("b", ["Gold 1"]),
      candidate("c", ["Gold 3"]),
    ]);

    expect(result).not.toBeNull();
    expect(result?.size).toBe(3);
    expect(result?.chosenRanks.a).toBe("Gold 2");
  });

  it("どの組み合わせでも制限を満たせない場合は null", () => {
    const result = findBestSmallParty([candidate("a", ["Iron 1"]), candidate("b", ["Radiant"])]);

    expect(result).toBeNull();
  });

  it("候補が1人しかいなければ null", () => {
    const result = findBestSmallParty([candidate("a", ["Gold 1"])]);
    expect(result).toBeNull();
  });

  it("Immortal3人はトリオ不可だがデュオは成立する", () => {
    const result = findBestSmallParty([
      candidate("a", ["Immortal 1"]),
      candidate("b", ["Immortal 2"]),
      candidate("c", ["Immortal 3"]),
    ]);

    expect(result).not.toBeNull();
    expect(result?.size).toBe(2);
  });

  it("ランク未取得（Unrated/未知のみ）の候補は除外される", () => {
    const result = findBestSmallParty([
      candidate("a", ["Unrated"]),
      candidate("b", ["Gold 1"]),
      candidate("c", ["Gold 2"]),
    ]);

    // a は除外され、b と c のデュオで成立
    expect(result).not.toBeNull();
    expect(result?.size).toBe(2);
    expect(result?.memberIds).toEqual(["b", "c"]);
  });

  it("集合時刻が早いパーティを優先する（デュオのタイブレーク）", () => {
    // 全員 Gold で 3 人だと 22:30 集合、a+b の 2 人なら 22:00 集合。
    // ただし 3 人成立を優先するため、ここでは 3 人が成立しないケースで時刻を比較する。
    const result = findBestSmallParty([
      candidate("a", ["Gold 1"], "2026-01-17T22:00:00.000Z"),
      candidate("b", ["Gold 2"], "2026-01-17T22:00:00.000Z"),
      candidate("c", ["Radiant"], "2026-01-17T21:00:00.000Z"),
    ]);

    // c は Gold と組めない。a+b のデュオが成立し集合時刻は 22:00。
    expect(result).not.toBeNull();
    expect(result?.size).toBe(2);
    expect(result?.memberIds).toEqual(["a", "b"]);
    expect(result?.meetTimeUtc).toBe("2026-01-17T22:00:00.000Z");
  });

  it("メンバーの最も遅い参加可能時刻を集合時刻にする", () => {
    const result = findBestSmallParty([
      candidate("a", ["Gold 1"], "2026-01-17T22:00:00.000Z"),
      candidate("b", ["Gold 2"], "2026-01-17T22:30:00.000Z"),
      candidate("c", ["Gold 3"], "2026-01-17T22:15:00.000Z"),
    ]);

    expect(result?.meetTimeUtc).toBe("2026-01-17T22:30:00.000Z");
  });
});
