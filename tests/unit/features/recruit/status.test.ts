import { describe, expect, it } from "vitest";
import { isRecruitActive } from "../../../../src/features/recruit/status";

describe("isRecruitActive", () => {
  it("open / matched はアクティブ", () => {
    expect(isRecruitActive("open")).toBe(true);
    expect(isRecruitActive("matched")).toBe(true);
  });

  it("closed / cancelled / deleted は終端（非アクティブ）", () => {
    expect(isRecruitActive("closed")).toBe(false);
    expect(isRecruitActive("cancelled")).toBe(false);
    expect(isRecruitActive("deleted")).toBe(false);
  });

  it("未知の状態は安全側で非アクティブ扱い", () => {
    expect(isRecruitActive("unknown")).toBe(false);
    expect(isRecruitActive("")).toBe(false);
  });
});
