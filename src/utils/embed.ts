export interface RecruitEmbedParams {
  targetDateLocal: string;
  postTimeHHmm: string;
  status: "open" | "matched" | "cancelled" | "deleted";
  confirmedCount: number;
  pendingCount: number;
  matchedMembers?: string[];
  matchedTime?: string;
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

  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: "参加状況",
      value: `確定: ${params.confirmedCount}人\n回答待ち: ${params.pendingCount}人`,
      inline: true,
    },
  ];

  if (params.status === "matched" && params.matchedMembers && params.matchedTime) {
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
