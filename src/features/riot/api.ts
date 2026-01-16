export interface ValorantRank {
  tier: number;
  division: string;
  rank: string;
}

export interface ValorantAccount {
  name: string;
  tag: string;
  rank: ValorantRank | null;
}

export interface FetchRankResult {
  success: boolean;
  account: ValorantAccount | null;
  error: string | null;
}

export async function fetchValorantRank(
  gameName: string,
  tagLine: string,
  apiKey: string,
  region = "na",
): Promise<FetchRankResult> {
  try {
    const response = await fetch(
      `https://api.henrikdev.xyz/valorant/v1/mmr/${region}/${gameName}/${tagLine}`,
      {
        headers: {
          Authorization: apiKey,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        account: null,
        error: `API error: ${response.status} ${text}`,
      };
    }

    const data = (await response.json()) as {
      data: {
        name: string;
        tag: string;
        currenttier: number | null;
        ranking_in_tier: number | null;
      } | null;
    };

    if (!data.data) {
      return {
        success: false,
        account: null,
        error: "Account not found",
      };
    }

    const rank = data.data.currenttier
      ? tierToRank(data.data.currenttier, data.data.ranking_in_tier ?? 0)
      : null;

    return {
      success: true,
      account: {
        name: data.data.name,
        tag: data.data.tag,
        rank,
      },
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      account: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function tierToRank(tier: number, division: number): ValorantRank {
  const ranks = [
    "Unrated",
    "Iron",
    "Bronze",
    "Silver",
    "Gold",
    "Platinum",
    "Diamond",
    "Ascendant",
    "Immortal",
    "Radiant",
  ];

  const tierIndex = Math.floor(tier / 3);
  const divisionIndex = tier % 3;

  const rankName = ranks[tierIndex] ?? "Unrated";
  const divisions = ["1", "2", "3"];
  const divisionName = divisions[divisionIndex] ?? "1";

  return {
    tier,
    division: divisionName,
    rank: `${rankName} ${divisionName}`,
  };
}

export function formatRankLabel(account: ValorantAccount): string {
  if (!account.rank) {
    return `${account.name}#${account.tag} (Unrated)`;
  }
  return `${account.name}#${account.tag} (${account.rank.rank})`;
}
