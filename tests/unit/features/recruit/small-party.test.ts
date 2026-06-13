import { describe, expect, it } from "vitest";
import {
  applyConsent,
  buildSmallPartyProposal,
  formatRegisterNudge,
  formatSmallPartyProposal,
} from "../../../../src/features/recruit";

const entry = (
  userId: string,
  availableFromUtc: string,
  createdAtUtc = "2026-01-17T20:00:00.000Z",
) => ({
  userId,
  availableFromUtc,
  createdAtUtc,
});

describe("buildSmallPartyProposal", () => {
  const slot = "2026-01-17T22:00:00.000Z";

  it("スロットまでに参加可能な確定者から成立パーティを返す", () => {
    const confirmed = [
      entry("a", "2026-01-17T21:30:00.000Z"),
      entry("b", "2026-01-17T22:00:00.000Z"),
      entry("c", "2026-01-17T22:00:00.000Z"),
    ];
    const ranks = new Map([
      ["a", ["Gold 1"]],
      ["b", ["Gold 2"]],
      ["c", ["Gold 3"]],
    ]);

    const result = buildSmallPartyProposal(confirmed, ranks, slot);

    expect(result).not.toBeNull();
    expect(result?.party.size).toBe(3);
    expect(result?.party.memberIds).toEqual(["a", "b", "c"]);
    expect(result?.unrankedUserIds).toEqual([]);
  });

  it("スロット後にしか参加できない確定者は除外する", () => {
    const confirmed = [
      entry("a", "2026-01-17T22:00:00.000Z"),
      entry("b", "2026-01-17T22:00:00.000Z"),
      entry("late", "2026-01-17T22:30:00.000Z"), // スロット後
    ];
    const ranks = new Map([
      ["a", ["Gold 1"]],
      ["b", ["Gold 2"]],
      ["late", ["Gold 3"]],
    ]);

    const result = buildSmallPartyProposal(confirmed, ranks, slot);

    expect(result?.party.memberIds).toEqual(["a", "b"]);
  });

  it("ランク未取得の参加可能者を登録促し対象として返す", () => {
    const confirmed = [
      entry("a", "2026-01-17T22:00:00.000Z"),
      entry("b", "2026-01-17T22:00:00.000Z"),
      entry("noRank", "2026-01-17T22:00:00.000Z"),
    ];
    const ranks = new Map([
      ["a", ["Gold 1"]],
      ["b", ["Gold 2"]],
      ["noRank", ["Unrated"]],
    ]);

    const result = buildSmallPartyProposal(confirmed, ranks, slot);

    expect(result?.party.memberIds).toEqual(["a", "b"]);
    expect(result?.unrankedUserIds).toEqual(["noRank"]);
  });

  it("参加可能者が2人未満なら null", () => {
    const confirmed = [entry("a", "2026-01-17T22:00:00.000Z")];
    const ranks = new Map([["a", ["Gold 1"]]]);

    expect(buildSmallPartyProposal(confirmed, ranks, slot)).toBeNull();
  });

  it("成立する組み合わせが無ければ null", () => {
    const confirmed = [
      entry("a", "2026-01-17T22:00:00.000Z"),
      entry("b", "2026-01-17T22:00:00.000Z"),
    ];
    const ranks = new Map([
      ["a", ["Iron 1"]],
      ["b", ["Radiant"]],
    ]);

    expect(buildSmallPartyProposal(confirmed, ranks, slot)).toBeNull();
  });
});

describe("formatSmallPartyProposal", () => {
  it("人数・集合時刻・メンバーを含む提案文を生成する", () => {
    const msg = formatSmallPartyProposal(["a", "b"], "2026-01-17T13:00:00.000Z", 2, "Asia/Tokyo");

    expect(msg).toContain("2人");
    expect(msg).toContain("22:00"); // JST
    expect(msg).toContain("<@a>");
    expect(msg).toContain("<@b>");
    expect(msg).toContain("行く");
  });
});

describe("formatRegisterNudge", () => {
  it("未登録ユーザーをメンションし /riot add を案内する", () => {
    const msg = formatRegisterNudge(["x", "y"]);
    expect(msg).toContain("<@x>");
    expect(msg).toContain("<@y>");
    expect(msg).toContain("/riot add");
  });
});

describe("applyConsent", () => {
  const members = ["a", "b", "c"];

  it("対象外ユーザーの押下は同意に反映されない", () => {
    const result = applyConsent(members, [], "z");
    expect(result.isMember).toBe(false);
    expect(result.consent).toEqual([]);
    expect(result.allConfirmed).toBe(false);
  });

  it("対象メンバーの押下を同意に追加する（一部）", () => {
    const result = applyConsent(members, ["a"], "b");
    expect(result.isMember).toBe(true);
    expect(result.consent.sort()).toEqual(["a", "b"]);
    expect(result.allConfirmed).toBe(false);
  });

  it("全員が同意したら allConfirmed が true", () => {
    const result = applyConsent(members, ["a", "b"], "c");
    expect(result.allConfirmed).toBe(true);
    expect(result.consent.sort()).toEqual(["a", "b", "c"]);
  });

  it("重複押下しても同意は二重登録されない", () => {
    const result = applyConsent(members, ["a", "b"], "a");
    expect(result.consent.sort()).toEqual(["a", "b"]);
    expect(result.allConfirmed).toBe(false);
  });

  it("メンバー外の残留IDは同意から除外される", () => {
    const result = applyConsent(members, ["a", "stray"], "b");
    expect(result.consent.sort()).toEqual(["a", "b"]);
  });
});
