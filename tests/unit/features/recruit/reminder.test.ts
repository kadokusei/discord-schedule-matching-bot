import { describe, it, expect } from "vitest";
import { buildUndecidedNudge } from "../../../../src/features/recruit";

describe("buildUndecidedNudge", () => {
  it("人数が揃ったので時間決定を促す文言を返す", () => {
    const message = buildUndecidedNudge();
    expect(message).toContain("希望時間");
    expect(message.length).toBeGreaterThan(0);
  });
});
