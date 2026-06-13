import { describe, expect, it } from "vitest";
import { isSignatureBypassEnabled } from "../../../src/lib/security";

describe("isSignatureBypassEnabled", () => {
  it("本番(production)では DISABLE_SIGNATURE_VERIFICATION=true でもバイパスを許可しない", () => {
    expect(
      isSignatureBypassEnabled({
        ENVIRONMENT: "production",
        DISABLE_SIGNATURE_VERIFICATION: "true",
      }),
    ).toBe(false);
  });

  it("非本番(development/staging)かつ true のときのみバイパスを許可する", () => {
    expect(
      isSignatureBypassEnabled({
        ENVIRONMENT: "development",
        DISABLE_SIGNATURE_VERIFICATION: "true",
      }),
    ).toBe(true);
    expect(
      isSignatureBypassEnabled({
        ENVIRONMENT: "staging",
        DISABLE_SIGNATURE_VERIFICATION: "true",
      }),
    ).toBe(true);
  });

  it("ENVIRONMENT 未設定でも true ならバイパスを許可する（ローカル/テスト用）", () => {
    expect(isSignatureBypassEnabled({ DISABLE_SIGNATURE_VERIFICATION: "true" })).toBe(true);
  });

  it("DISABLE_SIGNATURE_VERIFICATION が true 以外なら常にバイパスしない", () => {
    expect(
      isSignatureBypassEnabled({ ENVIRONMENT: "development", DISABLE_SIGNATURE_VERIFICATION: "1" }),
    ).toBe(false);
    expect(isSignatureBypassEnabled({ ENVIRONMENT: "development" })).toBe(false);
  });
});
