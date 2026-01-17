export interface RecruitEmbedParams {
  targetDateLocal: string;
  postTimeHHmm: string;
  status: "open" | "matched" | "cancelled" | "deleted";
  confirmedCount: number;
  pendingCount: number;
  confirmedUsers?: { userId: string; availableFromUtc: string }[];
  pendingUserIds?: string[];
  matchedMembers?: string[];
  matchedTime?: string;
  timezone?: string;
}

function formatConfirmedUsers(
  users: { userId: string; availableFromUtc: string }[],
  timezone?: string,
): string {
  if (users.length === 0) return "";

  return users
    .map((user) => {
      const time = new Date(user.availableFromUtc).toLocaleTimeString("ja-JP", {
        timeZone: timezone ?? "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `<@${user.userId}> (${time})`;
    })
    .join(" ");
}

function formatPendingUsers(userIds: string[]): string {
  if (userIds.length === 0) return "";

  return userIds.map((id) => `<@${id}> (時間回答待ち)`).join(" ");
}

export function buildRecruitEmbed(params: RecruitEmbedParams) {
  const color = getEmbedColor(params.status);

  const title =
    params.status === "deleted"
      ? "【募集】(削除済み)"
      : params.status === "cancelled"
        ? "【募集】(取消)"
        : params.status === "matched"
          ? "【確定】"
          : "【募集】";

  const description = `日付: ${params.targetDateLocal}\n投稿時間: ${params.postTimeHHmm}`;

  let statusValue = `確定: ${params.confirmedCount}人`;
  if (params.confirmedUsers && params.confirmedUsers.length > 0) {
    statusValue += `\n${formatConfirmedUsers(params.confirmedUsers, params.timezone)}`;
  }
  statusValue += `\n回答待ち: ${params.pendingCount}人`;
  if (params.pendingUserIds && params.pendingUserIds.length > 0) {
    statusValue += `\n${formatPendingUsers(params.pendingUserIds)}`;
  }

  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: "参加状況",
      value: statusValue,
      inline: true,
    },
  ];

  if (
    params.status === "matched" &&
    params.matchedMembers &&
    params.matchedTime
  ) {
    fields.push({
      name: "マッチング結果",
      value: `集合時刻: ${params.matchedTime}\nメンバー: ${params.matchedMembers.map((id) => `<@${id}>`).join(", ")}`,
      inline: false,
    });
  }

  return {
    embeds: [
      {
        title,
        description,
        color,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function getEmbedColor(
  status: "open" | "matched" | "cancelled" | "deleted",
): number {
  switch (status) {
    case "open":
      return 0x00ff00; // 緑
    case "matched":
      return 0x0000ff; // 青
    case "cancelled":
      return 0xff0000; // 赤
    case "deleted":
      return 0x808080; // グレー
  }
}
