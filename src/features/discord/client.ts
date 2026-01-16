
import { buildRecruitEmbed } from "./embed";
import type { Env } from "../../lib/types";

export async function postChannelMessage(
  env: Env,
  channelId: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ content }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

export async function deleteDiscordMessage(
  env: Env,
  channelId: string,
  messageId: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

export async function updateDiscordMessage(
  env: Env,
  channelId: string,
  messageId: string,
  params: {
    targetDateLocal: string;
    postTimeHHmm: string;
    status: "open" | "matched" | "cancelled" | "deleted";
    confirmedCount: number;
    pendingCount: number;
    matchedMembers?: string[];
    matchedTime?: string;
  },
): Promise<void> {
  const embedData = buildRecruitEmbed(params);

  const payload = {
    embeds: embedData.embeds,
  };

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

export async function postRecruitMessage(
  env: Env,
  channelId: string,
  params: {
    recruitId: string;
    targetDateLocal: string;
    postTimeHHmm: string;
    template: string;
  },
): Promise<string> {
  const embedData = buildRecruitEmbed({
    targetDateLocal: params.targetDateLocal,
    postTimeHHmm: params.postTimeHHmm,
    status: "open",
    confirmedCount: 0,
    pendingCount: 0,
  });

  const payload = {
    content:
      params.template ||
      `【募集】${params.targetDateLocal} ${params.postTimeHHmm}`,
    embeds: embedData.embeds,
    components: [
      {
        type: 1, // ActionRow
        components: [
          {
            type: 2, // Button
            style: 1, // Primary
            label: "参加",
            custom_id: `recruit:join:${params.recruitId}`,
          },
          {
            type: 2,
            style: 2,
            label: "キャンセル",
            custom_id: `recruit:cancel:${params.recruitId}`,
          },
        ],
      },
    ],
  };

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}
