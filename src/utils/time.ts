export interface TimeOption {
  label: string;
  value: string;
}

function localDateTimeToUtc(dateLocal: string, timeHHmm: string, tz: string): Date {
  const [hours, minutes] = timeHHmm.split(":").map(Number);
  const dateTimeStr = `${dateLocal}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

  const date = new Date(dateTimeStr);

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

  const parts = formatter.formatToParts(date);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);

  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
}

export function buildTimeOptions(
  targetDateLocal: string,
  postTimeHHmm: string,
  intervalMin: number,
  durationMin: number,
  tz: string,
): TimeOption[] {
  const baseDate = localDateTimeToUtc(targetDateLocal, postTimeHHmm, tz);

  const options: TimeOption[] = [];
  const totalOptions = durationMin / intervalMin + 1;

  for (let i = 0; i < totalOptions; i++) {
    const date = new Date(baseDate.getTime() + i * intervalMin * 60 * 1000);
    const label = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    const value = date.toISOString();
    options.push({ label, value });
  }

  return options;
}
