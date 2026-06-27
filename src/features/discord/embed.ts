import { type PartySizePreference, partySizePreferenceLabel } from "../../features/recruit";

export interface RecruitEmbedParams {
  targetDateLocal: string;
  postTimeHHmm: string;
  status: "open" | "matched" | "cancelled" | "deleted";
  confirmedCount: number;
  confirmedUsers?: {
    userId: string;
    availableFromUtc: string;
    partySizePreference: PartySizePreference;
  }[];
  matchedMembers?: string[];
  matchedTime?: string;
  /** 全員集合より早く始められるサブ組（あれば確定時に併記）。 */
  earlierSubParty?: { memberIds: string[]; meetTimeUtc: string };
  /** open 状態かつ2〜4人確定時に、今のスロットまでに集合可能な最良編成候補。 */
  formationCandidate?: { memberIds: string[]; meetTimeUtc: string };
  timezone?: string;
}

function formatConfirmedUsers(
  users: {
    userId: string;
    availableFromUtc: string;
    partySizePreference: PartySizePreference;
  }[],
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
      return `<@${user.userId}> (${time} / ${partySizePreferenceLabel(user.partySizePreference)})`;
    })
    .join(" ");
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

  const confirmedUsersPart =
    params.confirmedUsers && params.confirmedUsers.length > 0
      ? `\n${formatConfirmedUsers(params.confirmedUsers, params.timezone)}`
      : "";

  const statusValue = `参加: ${params.confirmedCount}人${confirmedUsersPart}`;

  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: "参加状況",
      value: statusValue,
      inline: true,
    },
  ];

  const matchedField =
    params.status === "matched" && params.matchedMembers && params.matchedTime
      ? [
          {
            name: "マッチング結果",
            value: `集合時刻: ${params.matchedTime}\nメンバー: ${params.matchedMembers.map((id) => `<@${id}>`).join(", ")}`,
            inline: false,
          },
        ]
      : [];

  const earlierSubPartyField =
    params.status === "matched" &&
    params.earlierSubParty &&
    params.earlierSubParty.memberIds.length > 0
      ? [
          {
            name: "早く始めるなら",
            value: `集合時刻: ${new Date(params.earlierSubParty.meetTimeUtc).toLocaleTimeString(
              "ja-JP",
              { timeZone: params.timezone ?? "Asia/Tokyo", hour: "2-digit", minute: "2-digit" },
            )}\nメンバー: ${params.earlierSubParty.memberIds.map((id) => `<@${id}>`).join(", ")}`,
            inline: false,
          },
        ]
      : [];

  const formationField =
    params.status === "open" &&
    params.formationCandidate &&
    params.formationCandidate.memberIds.length > 0
      ? [
          {
            name: "編成候補",
            value: `集合時刻: ${new Date(params.formationCandidate.meetTimeUtc).toLocaleTimeString("ja-JP", { timeZone: params.timezone ?? "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}\nメンバー: ${params.formationCandidate.memberIds.map((id) => `<@${id}>`).join(", ")}`,
            inline: false,
          },
        ]
      : [];

  const finalFields = [...fields, ...matchedField, ...earlierSubPartyField, ...formationField];

  return {
    embeds: [
      {
        title,
        description,
        color,
        fields: finalFields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function getEmbedColor(status: "open" | "matched" | "cancelled" | "deleted"): number {
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
