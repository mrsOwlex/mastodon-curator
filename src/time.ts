export function resolveUserTimezone(preferred?: string): string {
  const candidates = [preferred, process.env.TZ, 'Europe/Berlin', 'UTC'];
  for (const timezone of candidates) {
    if (!timezone) {
      continue;
    }
    if (isValidTimezone(timezone)) {
      return timezone;
    }
  }
  return 'UTC';
}

export function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = getDateParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatNowInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('de-DE', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getDateParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
  };
}
