import { describe, expect, it } from "vitest";
import {
  type SmallPartyCandidate,
  canUserJoinAnyParty,
  findBestSmallParty,
  findEarliestSubParty,
} from "../../../../src/features/matching";

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

describe("canUserJoinAnyParty", () => {
  it("ランク取得可能アカウントが無ければ false", () => {
    expect(canUserJoinAnyParty([], [["Gold 1"], ["Gold 2"]])).toBe(false);
    expect(canUserJoinAnyParty(["Unrated"], [["Gold 1"], ["Gold 2"]])).toBe(false);
  });

  it("組める相手が一人もいなければ false", () => {
    expect(canUserJoinAnyParty(["Gold 1"], [])).toBe(false);
    // 相手がランク無しのみ
    expect(canUserJoinAnyParty(["Gold 1"], [["Unrated"]])).toBe(false);
  });

  it("近いランクの相手とは組める", () => {
    expect(canUserJoinAnyParty(["Gold 1"], [["Gold 3"]])).toBe(true);
    expect(canUserJoinAnyParty(["Silver 1"], [["Gold 2"]])).toBe(true);
  });

  it("ランク差が大きすぎる相手とは組めない", () => {
    expect(canUserJoinAnyParty(["Iron 1"], [["Radiant"]])).toBe(false);
  });

  it("複数アカウントのいずれかが適合すれば true", () => {
    // Iron では Radiant と組めないが、Immortal アカウントを使えばデュオで組める
    expect(canUserJoinAnyParty(["Iron 1", "Immortal 1"], [["Immortal 2"]])).toBe(true);
  });

  it("3人目を含めて組める相手がいれば true", () => {
    expect(canUserJoinAnyParty(["Gold 1"], [["Gold 2"], ["Gold 3"]])).toBe(true);
  });
});

describe("findEarliestSubParty", () => {
  const beforeUtc = "2026-01-17T23:00:00.000Z";

  it("全員集合より早く始められる組があれば返す", () => {
    const result = findEarliestSubParty(
      [
        candidate("a", ["Gold 1"], "2026-01-17T22:00:00.000Z"),
        candidate("b", ["Gold 2"], "2026-01-17T22:00:00.000Z"),
        candidate("c", ["Gold 3"], "2026-01-17T22:30:00.000Z"),
      ],
      beforeUtc,
    );

    expect(result).not.toBeNull();
    expect(result?.meetTimeUtc).toBe("2026-01-17T22:00:00.000Z");
  });

  it("全員が同時刻なら早く始められる組は無く null", () => {
    const result = findEarliestSubParty(
      [
        candidate("a", ["Gold 1"], "2026-01-17T23:00:00.000Z"),
        candidate("b", ["Gold 2"], "2026-01-17T23:00:00.000Z"),
        candidate("c", ["Gold 3"], "2026-01-17T23:00:00.000Z"),
      ],
      beforeUtc,
    );

    expect(result).toBeNull();
  });

  it("同じ集合時刻なら人数が多い組を優先する", () => {
    // a,b,c は 22:00、d は 22:30。22:00 で 2人(a,b) も 3人(a,b,c) も組めるが 3人を優先。
    const result = findEarliestSubParty(
      [
        candidate("a", ["Gold 1"], "2026-01-17T22:00:00.000Z"),
        candidate("b", ["Gold 2"], "2026-01-17T22:00:00.000Z"),
        candidate("c", ["Gold 3"], "2026-01-17T22:00:00.000Z"),
        candidate("d", ["Gold 1"], "2026-01-17T22:30:00.000Z"),
      ],
      beforeUtc,
    );

    expect(result?.meetTimeUtc).toBe("2026-01-17T22:00:00.000Z");
    expect(result?.size).toBe(3);
    expect(result?.memberIds).toEqual(["a", "b", "c"]);
  });

  it("ランク差で組めない部分集合は除外し、最早の成立組を選ぶ", () => {
    // c(Radiant) は早いが Gold と組めない。a+b の 22:15 が最早の成立組。
    const result = findEarliestSubParty(
      [
        candidate("a", ["Gold 1"], "2026-01-17T22:15:00.000Z"),
        candidate("b", ["Gold 2"], "2026-01-17T22:15:00.000Z"),
        candidate("c", ["Radiant"], "2026-01-17T22:00:00.000Z"),
        candidate("d", ["Gold 3"], "2026-01-17T22:45:00.000Z"),
      ],
      beforeUtc,
    );

    expect(result?.meetTimeUtc).toBe("2026-01-17T22:15:00.000Z");
    expect(result?.memberIds).toEqual(["a", "b"]);
  });
});
