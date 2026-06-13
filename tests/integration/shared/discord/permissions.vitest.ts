import { PermissionFlagsBits } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { canManageSchedule } from "../../../../src/shared/discord/permissions";

const MANAGE_GUILD = PermissionFlagsBits.ManageGuild.toString();
const ADMINISTRATOR = PermissionFlagsBits.Administrator.toString();
const SEND_MESSAGES = PermissionFlagsBits.SendMessages.toString(); // 権限なし相当

describe("canManageSchedule", () => {
  it("作成者本人は権限ビットが無くても許可される", () => {
    expect(
      canManageSchedule({ invokerId: "u1", creatorId: "u1", memberPermissions: SEND_MESSAGES }),
    ).toBe(true);
  });

  it("作成者でなく権限も無ければ拒否される", () => {
    expect(
      canManageSchedule({ invokerId: "u2", creatorId: "u1", memberPermissions: SEND_MESSAGES }),
    ).toBe(false);
  });

  it("ManageGuild 保持者は作成者でなくても許可される", () => {
    expect(
      canManageSchedule({ invokerId: "u2", creatorId: "u1", memberPermissions: MANAGE_GUILD }),
    ).toBe(true);
  });

  it("Administrator 保持者は許可される", () => {
    expect(
      canManageSchedule({ invokerId: "u2", creatorId: "u1", memberPermissions: ADMINISTRATOR }),
    ).toBe(true);
  });

  it("permissions が未指定/空なら作成者以外は拒否される", () => {
    expect(canManageSchedule({ invokerId: "u2", creatorId: "u1" })).toBe(false);
    expect(canManageSchedule({ invokerId: "u2", creatorId: "u1", memberPermissions: "" })).toBe(
      false,
    );
  });

  it("不正な permissions 文字列でも例外を投げず拒否扱い", () => {
    expect(
      canManageSchedule({ invokerId: "u2", creatorId: "u1", memberPermissions: "not-a-number" }),
    ).toBe(false);
  });

  it("invokerId が空のときは creatorId が空でも作成者扱いにしない", () => {
    expect(
      canManageSchedule({ invokerId: "", creatorId: "", memberPermissions: SEND_MESSAGES }),
    ).toBe(false);
  });
});
