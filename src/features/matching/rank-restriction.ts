// VALORANT コンペティティブの「2〜3人パーティ」ランク差制限ルールを集約する。
// ルールは将来変わりうるため、判定ロジックと閾値はこのモジュールに閉じ込める。

/** メジャーティア（昇順）。Radiant が最上位。 */
export const MAJOR_TIERS = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Ascendant",
  "Immortal",
  "Radiant",
] as const;

const SILVER = MAJOR_TIERS.indexOf("Silver");
const GOLD = MAJOR_TIERS.indexOf("Gold");
const PLATINUM = MAJOR_TIERS.indexOf("Platinum");
const IMMORTAL = MAJOR_TIERS.indexOf("Immortal");

/**
 * ランク文字列（例: "Iron 1", "Radiant"）をメジャーティアのインデックスへ変換する。
 * Unrated / 未知のランクはランク制限の対象にできないため null を返す。
 */
export function majorTierOf(rank: string): number | null {
  if (!rank) return null;
  const tierName = rank.split(" ")[0];
  const index = MAJOR_TIERS.indexOf(tierName as (typeof MAJOR_TIERS)[number]);
  return index >= 0 ? index : null;
}

/**
 * 指定したメジャーティア構成のパーティがコンペでキューを組めるか判定する。
 * - 最低ランク者を基準に許容上限が決まる:
 *   - Iron/Bronze → 全員 Silver 以下
 *   - Silver → 全員 Gold 以下
 *   - Gold → 全員 Platinum 以下
 *   - Platinum 以上 → 全員「最低ランク+1ティア」以内
 * - Immortal 以上のメンバーがいる場合、3人パーティは不可（ソロ/デュオ/5スタックのみ）。
 */
export function canQueueAsParty(majorTiers: number[]): boolean {
  if (majorTiers.length <= 1) return true;

  const min = Math.min(...majorTiers);
  const max = Math.max(...majorTiers);

  // Immortal 以上を含む 3 人パーティは不可
  if (majorTiers.length >= 3 && max >= IMMORTAL) {
    return false;
  }

  // 最低ランク者を基準とした許容上限
  const allowedMax =
    min < SILVER
      ? SILVER // Iron / Bronze
      : min === SILVER
        ? GOLD
        : min === GOLD
          ? PLATINUM
          : min + 1; // Platinum 以上

  return max <= allowedMax;
}
