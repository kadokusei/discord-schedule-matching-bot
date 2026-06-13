import { buildTimeOptions } from "../../shared/time";

export interface Schedule {
  postTimeHHmm: string;
}

export interface RecruitInstance {
  targetDateLocal: string;
}

export interface IntervalSchedule {
  postTimeHHmm: string;
  intervalMin: number;
  durationMin: number;
}

/**
 * いま到来している interval スロット境界（UTC ISO8601）を返す。
 * - 募集枠は postTime から intervalMin 刻みで durationMin まで。
 * - now 以下で最も新しいスロットを返す。
 * - 最初のスロット前、または最終スロットを過ぎた場合は null（提案対象外）。
 */
export function currentIntervalSlotUtc(
  recruit: { targetDateLocal: string },
  schedule: IntervalSchedule,
  tz: string,
  nowUtc: Date,
): string | null {
  const slots = buildTimeOptions(
    recruit.targetDateLocal,
    schedule.postTimeHHmm,
    schedule.intervalMin,
    schedule.durationMin,
    tz,
  ).map((o) => o.value);

  if (slots.length === 0) return null;

  const nowMs = nowUtc.getTime();
  const finalSlotMs = new Date(slots[slots.length - 1]).getTime();

  // 募集枠の最終スロットを過ぎたら対象外
  if (nowMs > finalSlotMs) return null;

  const pastSlots = slots.filter((s) => new Date(s).getTime() <= nowMs);
  if (pastSlots.length === 0) return null; // 最初のスロット前

  return pastSlots[pastSlots.length - 1];
}

export function shouldCreateInstance(
  nowUtc: Date,
  schedule: Schedule,
  tz: string,
  existingInstances: RecruitInstance[],
): boolean {
  const [hours, minutes] = schedule.postTimeHHmm.split(":").map(Number);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const nowParts = formatter.formatToParts(nowUtc);
  const year = Number(nowParts.find((p) => p.type === "year")?.value);
  const month = Number(nowParts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(nowParts.find((p) => p.type === "day")?.value);

  // ローカルタイムゾーンでの「その日の開始時刻（00:00:00）」をUTCで取得する
  // アプローチ: 同じローカル日付の UTC 00:00:00 をformatterに通して、
  // ローカルタイムゾーンでの時刻との差分を計算する
  const baseUtcDate = Date.UTC(year, month, day, 0, 0, 0);
  const formatted = formatter.format(new Date(baseUtcDate));
  const [, , , fHour, fMinute, fSecond] = formatted.split(/[/:\s,]+/).map(Number);

  // formatterが返すローカル時刻とUTC 00:00:00の差分（ミリ秒）
  // 例: UTC 00:00:00 → JST 09:00:00 の場合、差分は -9時間
  const localMidnightUtc = new Date(
    baseUtcDate - (fHour * 3600000 + fMinute * 60000 + fSecond * 1000),
  );
  const postTimeDate = new Date(localMidnightUtc.getTime() + hours * 3600000 + minutes * 60000);

  // 投稿時刻前は作成しない（時刻が等しい場合は作成する）。
  // post_time は「募集を投稿する時刻」であり、now >= post_time の最初の tick で当日分を作る。
  if (nowUtc.getTime() < postTimeDate.getTime()) {
    return false;
  }

  // 重複チェック
  const targetDateLocal = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const alreadyExists = existingInstances.some((inst) => inst.targetDateLocal === targetDateLocal);

  if (alreadyExists) {
    return false;
  }

  return true;
}
