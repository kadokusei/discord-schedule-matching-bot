/**
 * 募集参加者の希望パーティサイズ contract。
 * - any: 5 人フルマッチにも 2〜3 人少人数提案にも入る
 * - full_party: 5 人フルマッチのみ
 * - up_to_trio: 2〜3 人少人数提案のみ
 */
export const PARTY_SIZE_PREFERENCES = ["any", "full_party", "up_to_trio"] as const;
export type PartySizePreference = (typeof PARTY_SIZE_PREFERENCES)[number];

export const PARTY_SIZE_LABELS: Record<PartySizePreference, string> = {
  any: "なんでも",
  full_party: "フルパ",
  up_to_trio: "トリオまで",
};

export const isPartySizePreference = (value: string | undefined): value is PartySizePreference =>
  PARTY_SIZE_PREFERENCES.includes(value as PartySizePreference);

/** 5 人フルマッチ対象か（"up_to_trio" は含まない）。 */
export const allowsFullParty = (value: PartySizePreference): boolean => value !== "up_to_trio";

/** 2〜3 人少人数提案対象か（"full_party" は含まない）。 */
export const allowsSmallParty = (value: PartySizePreference): boolean => value !== "full_party";

export const partySizePreferenceLabel = (value: PartySizePreference): string =>
  PARTY_SIZE_LABELS[value];
