import { describe, expect, it } from "vitest";
import { canQueueAsParty, majorTierOf } from "../../../../src/features/matching";

// メジャーティア: Iron(0) Bronze(1) Silver(2) Gold(3) Platinum(4) Diamond(5) Ascendant(6) Immortal(7) Radiant(8)
const IRON = 0;
const BRONZE = 1;
const SILVER = 2;
const GOLD = 3;
const PLATINUM = 4;
const DIAMOND = 5;
const ASCENDANT = 6;
const IMMORTAL = 7;
const RADIANT = 8;

describe("majorTierOf", () => {
  it("ディビジョン付きランクをメジャーティアへ変換する", () => {
    expect(majorTierOf("Iron 1")).toBe(IRON);
    expect(majorTierOf("Iron 3")).toBe(IRON);
    expect(majorTierOf("Bronze 2")).toBe(BRONZE);
    expect(majorTierOf("Silver 1")).toBe(SILVER);
    expect(majorTierOf("Gold 3")).toBe(GOLD);
    expect(majorTierOf("Platinum 2")).toBe(PLATINUM);
    expect(majorTierOf("Diamond 1")).toBe(DIAMOND);
    expect(majorTierOf("Ascendant 3")).toBe(ASCENDANT);
    expect(majorTierOf("Immortal 2")).toBe(IMMORTAL);
  });

  it("Radiant は最上位ティア", () => {
    expect(majorTierOf("Radiant")).toBe(RADIANT);
  });

  it("Unrated / 未知のランクは null", () => {
    expect(majorTierOf("Unrated")).toBeNull();
    expect(majorTierOf("")).toBeNull();
    expect(majorTierOf("Bogus 5")).toBeNull();
  });
});

describe("canQueueAsParty - 低ランク帯（基準は最低ランク者）", () => {
  it("Iron + Silver は可", () => {
    expect(canQueueAsParty([IRON, SILVER])).toBe(true);
  });

  it("Iron + Gold は不可（Silver超過）", () => {
    expect(canQueueAsParty([IRON, GOLD])).toBe(false);
  });

  it("Bronze + Silver は可、Bronze + Gold は不可", () => {
    expect(canQueueAsParty([BRONZE, SILVER])).toBe(true);
    expect(canQueueAsParty([BRONZE, GOLD])).toBe(false);
  });

  it("Silver + Gold は可、Silver + Platinum は不可", () => {
    expect(canQueueAsParty([SILVER, GOLD])).toBe(true);
    expect(canQueueAsParty([SILVER, PLATINUM])).toBe(false);
  });

  it("Gold + Platinum は可、Gold + Diamond は不可", () => {
    expect(canQueueAsParty([GOLD, PLATINUM])).toBe(true);
    expect(canQueueAsParty([GOLD, DIAMOND])).toBe(false);
  });
});

describe("canQueueAsParty - 高ランク帯（最低ランク+1ティアまで）", () => {
  it("Platinum + Diamond は可、Platinum + Ascendant は不可", () => {
    expect(canQueueAsParty([PLATINUM, DIAMOND])).toBe(true);
    expect(canQueueAsParty([PLATINUM, ASCENDANT])).toBe(false);
  });

  it("Diamond + Ascendant は可", () => {
    expect(canQueueAsParty([DIAMOND, ASCENDANT])).toBe(true);
  });

  it("Ascendant + Immortal のデュオは可", () => {
    expect(canQueueAsParty([ASCENDANT, IMMORTAL])).toBe(true);
  });
});

describe("canQueueAsParty - Immortal以上の3人不可ルール", () => {
  it("Immortal を含む3人パーティは不可", () => {
    expect(canQueueAsParty([IMMORTAL, IMMORTAL, IMMORTAL])).toBe(false);
    expect(canQueueAsParty([ASCENDANT, IMMORTAL, IMMORTAL])).toBe(false);
  });

  it("Radiant を含む3人パーティは不可", () => {
    expect(canQueueAsParty([IMMORTAL, RADIANT, RADIANT])).toBe(false);
  });

  it("Immortal + Radiant のデュオは可（+1ティア）", () => {
    expect(canQueueAsParty([IMMORTAL, RADIANT])).toBe(true);
  });

  it("Radiant 単独デュオ(Radiant+Radiant)は可", () => {
    expect(canQueueAsParty([RADIANT, RADIANT])).toBe(true);
  });

  it("Immortal を含まない3人（Gold帯）は可", () => {
    expect(canQueueAsParty([GOLD, GOLD, PLATINUM])).toBe(true);
  });
});
