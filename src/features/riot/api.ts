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
  region = "ap",
  platform = "pc",
): Promise<FetchRankResult> {
  try {
    const response = await fetch(
      `https://api.henrikdev.xyz/valorant/v3/mmr/${region}/${platform}/${gameName}/${tagLine}`,
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
        account: {
          name: string;
          tag: string;
        };
        current: {
          tier: {
            id: number;
            name: string;
          };
        } | null;
      } | null;
    };

    if (!data.data) {
      return {
        success: false,
        account: null,
        error: "Account not found",
      };
    }

    const currentTier = data.data.current?.tier?.id ?? null;
    const rank = currentTier !== null ? tierToRank(currentTier, 0) : null;

    return {
      success: true,
      account: {
        name: data.data.account.name,
        tag: data.data.account.tag,
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
