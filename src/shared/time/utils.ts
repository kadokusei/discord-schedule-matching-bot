export interface TimeOption {
  label: string;
  value: string;
}

export function localDateTimeToUtc(
  dateLocal: string,
  timeHHmm: string,
  tz: string,
): Date {
  const [year, month, day] = dateLocal.split("-").map(Number);
  const [hours, minutes] = timeHHmm.split(":").map(Number);

  // Create a date in UTC (treat local time as UTC first)
  const utcDate = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, 0, 0),
  );

  // Get the timezone offset using Intl
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(utcDate);
  const timeZonePart = parts.find((p) => p.type === "timeZoneName");
  const offsetString = timeZonePart?.value ?? "";

  // Parse offset like "GMT+09:00"
  const match = offsetString.match(/GMT([+-])(\d{2}):(\d{2})/);
  let offsetMinutes = 0;
  if (match) {
    const sign = match[1] === "+" ? 1 : -1;
    const offsetHours = Number.parseInt(match[2], 10);
    const offsetMins = Number.parseInt(match[3], 10);
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  // Adjust UTC date by subtracting timezone offset
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

  const options: TimeOption[] = [];
  const totalOptions = durationMin / intervalMin + 1;

  for (let i = 0; i < totalOptions; i++) {
    const date = new Date(baseDate.getTime() + i * intervalMin * 60 * 1000);

    // Get time in the specified timezone for the label
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const label = formatter.format(date);
    const value = date.toISOString();
    options.push({ label, value });
  }

  return options;
}
