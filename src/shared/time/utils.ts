export interface TimeOption {
  label: string;
  value: string;
}

/** StringSelect の選択肢上限（Discord API 制約）。 */
export const MAX_TIME_OPTIONS = 25;

/** 時間選択セレクトで「未定」を表す value。時間スロット(ISO8601)と区別する固定値。 */
export const UNDECIDED_VALUE = "undecided";

/** 時間選択メニューの選択肢数（= buildTimeOptions が生成する件数）を算出する。 */
export function timeOptionCount(intervalMin: number, durationMin: number): number {
  return Math.floor(durationMin / intervalMin) + 1;
}

export function localDateTimeToUtc(dateLocal: string, timeHHmm: string, tz: string): Date {
  const [year, month, day] = dateLocal.split("-").map(Number);
  const [hours, minutes] = timeHHmm.split(":").map(Number);

  // Create a date in UTC (treat local time as UTC first)
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));

  // Get the timezone offset using Intl
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(utcDate);
  const timeZonePart = parts.find((p) => p.type === "timeZoneName");
  const offsetString = timeZonePart?.value ?? "";

  const match = offsetString.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match
    ? (match[1] === "+" ? 1 : -1) *
      (Number.parseInt(match[2], 10) * 60 + Number.parseInt(match[3], 10))
    : 0;

  return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
}

export function buildTimeOptions(
  targetDateLocal: string,
  postTimeHHmm: string,
  intervalMin: number,
  durationMin: number,
  tz: string,
): TimeOption[] {
  const baseDate = localDateTimeToUtc(targetDateLocal, postTimeHHmm, tz);

  const options = Array.from({ length: timeOptionCount(intervalMin, durationMin) }, (_, i) => {
    const date = new Date(baseDate.getTime() + i * intervalMin * 60 * 1000);

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const label = formatter.format(date);
    const value = date.toISOString();

    return { label, value };
  });

  return options;
}
