import type {
  APIActionRowComponent,
  APIAllowedMentions,
  APIComponentInMessageActionRow,
  APIInteractionResponseCallbackData,
  RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import type { Env } from "../../lib/types";
import { type PartySizePreference } from "../../features/recruit";
import { buildRecruitEmbed } from "./embed";

const DISCORD_API_BASE = "https://discord.com/api/v10";

/** メンションの ping 範囲制御。未指定時は ping しない（parse: []） */
export type AllowedMentions = APIAllowedMentions;

const NO_MENTIONS: AllowedMentions = { parse: [] };

export async function postChannelMessage(
  env: Env,
  channelId: string,
  content: string,
  allowedMentions: AllowedMentions = NO_MENTIONS,
): Promise<void> {
  const body: RESTPostAPIChannelMessageJSONBody = {
    content,
    allowed_mentions: allowedMentions,
  };

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

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
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

export interface UpdateRecruitMessageParams {
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
  earlierSubParty?: { memberIds: string[]; meetTimeUtc: string };
  /** open 状態かつ2〜4人確定時に、今のスロットまでに集合可能な最良編成候補。 */
  formationCandidate?: { memberIds: string[]; meetTimeUtc: string };
  timezone?: string;
}

export async function updateDiscordMessage(
  env: Env,
  channelId: string,
  messageId: string,
  params: UpdateRecruitMessageParams,
): Promise<void> {
  const embedData = buildRecruitEmbed(params);

  // 終端状態（クローズ/削除）になった募集はボタンを残さない。
  // components を空配列で送ることで、古い参加/キャンセル/時間選択ボタンを除去し、
  // クローズ後にコンポーネント経由で募集が復活させられるのを防ぐ。
  const isTerminal = params.status === "cancelled" || params.status === "deleted";

  const payload = {
    embeds: embedData.embeds,
    ...(isTerminal ? { components: [] } : {}),
    // Embed 内の <@id> は ping しないが、明示しておく
    allowed_mentions: NO_MENTIONS,
  };

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

/**
 * 募集メッセージに付与する公開コンポーネント。
 * 1行目: 登録・更新（Modal を開く Primary Button）。2行目: キャンセル（Secondary Button）。
 * 削除は /schedule delete に一本化。
 */
export function buildRecruitComponents(
  recruitId: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Primary,
          label: "登録・更新",
          custom_id: `recruit:register:${recruitId}`,
        },
      ],
    },
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "キャンセル",
          custom_id: `recruit:cancel:${recruitId}`,
        },
      ],
    },
  ];
}

export async function postRecruitMessage(
  env: Env,
  channelId: string,
  params: {
    recruitId: string;
    targetDateLocal: string;
    postTimeHHmm: string;
    template: string;
    intervalMin: number;
    durationMin: number;
    timezone: string;
  },
): Promise<string> {
  const embedData = buildRecruitEmbed({
    targetDateLocal: params.targetDateLocal,
    postTimeHHmm: params.postTimeHHmm,
    status: "open",
    confirmedCount: 0,
  });

  const payload = {
    content: params.template || `【募集】${params.targetDateLocal} ${params.postTimeHHmm}`,
    embeds: embedData.embeds,
    components: buildRecruitComponents(params.recruitId),
    allowed_mentions: NO_MENTIONS,
  };

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * deferred 応答後に元の interaction response（@original）を編集する。
 * Bot トークン不要・interaction token ベース。
 */
export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  body: APIInteractionResponseCallbackData,
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_mentions: NO_MENTIONS, ...body }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}
