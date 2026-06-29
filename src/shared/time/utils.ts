export interface TimeOption {
  label: string;
  value: string;
}

/** StringSelect の選択肢上限（Discord API 制約）。 */
export const MAX_TIME_OPTIONS = 25;

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

/**
 * Modal の時間 select で default 選択する候補値を解決する。
 *
 * 1. 既存登録の availableFromUtc が候補内に存在すればそれを返す（更新時の優先）。
 * 2. now 以下の最新候補を返す。now が最初の候補より前なら先頭、最後より後なら末尾に clamp する。
 *    Discord select は候補外値を default にできないため、候補内で最も近い端に丸める。
 * 3. 候補が空なら undefined（Modal 生成側は default を付けない）。
 */
export function resolveDefaultTimeOptionValue(
  timeOptions: TimeOption[],
  existingAvailableFromUtc: string | null | undefined,
  now: Date = new Date(),
): string | undefined {
  if (
    existingAvailableFromUtc &&
    timeOptions.some((opt) => opt.value === existingAvailableFromUtc)
  ) {
    return existingAvailableFromUtc;
  }
  if (timeOptions.length === 0) return undefined;

  const nowMs = now.getTime();
  let result = timeOptions[0]?.value;
  for (const opt of timeOptions) {
    if (Date.parse(opt.value) <= nowMs) {
      result = opt.value;
    } else {
      break;
    }
  }
  return result;
}
