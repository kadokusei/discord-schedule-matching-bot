import { PermissionFlagsBits } from "discord-api-types/v10";

/**
 * interaction.member.permissions（10進文字列のビットフィールド）に
 * Administrator もしくは ManageGuild が含まれるか判定する。
 */
const hasAdminOrManageGuild = (permissions: string | null | undefined): boolean => {
  if (!permissions) return false;
  let bits: bigint;
  try {
    bits = BigInt(permissions);
  } catch {
    return false;
  }
  const mask = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild;
  return (bits & mask) !== 0n;
};

/**
 * 定期予定に対する破壊的操作（削除など）の権限を判定する。
 * 許可: 作成者本人、または ManageGuild/Administrator 権限保持者。
 *
 * Discord のコマンドレベル default_member_permissions はサブコマンド単位に
 * 設定できず create/list まで巻き込むため、認可はサーバー側のこの関数で行う。
 */
export const canManageSchedule = (params: {
  invokerId: string;
  creatorId: string;
  memberPermissions?: string | null;
}): boolean => {
  const isCreator = params.invokerId !== "" && params.invokerId === params.creatorId;
  return isCreator || hasAdminOrManageGuild(params.memberPermissions);
};
