// Time-zone helpers on top of Intl (no dependencies, so they run on Node and Deno alike).

export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parts(date: Date, timeZone: string): Parts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(formatted.find((p) => p.type === type)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export const localMinutes = (date: Date, timeZone: string): number => {
  const p = parts(date, timeZone);
  return p.hour * 60 + p.minute;
};

export const localDate = (date: Date, timeZone: string): string => {
  const p = parts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

// offset of the zone from UTC at this instant, in ms
function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(date.getTime() / 1000) * 1000
  );
}

// the instant at which the wall clock in `timeZone` shows y-m-d hh:mm (re-checks the offset to cross DST changeovers)
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(new Date(asUtc), timeZone);
  let result = asUtc - first;
  const second = offsetMs(new Date(result), timeZone);
  if (second !== first) result = asUtc - second;
  return new Date(result);
}

/** The next occurrence of HH:MM local time strictly after `now`. */
export function nextLocalTime(now: Date, hhmm: string, timeZone: string): Date {
  const minutes = parseHHMM(hhmm);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const p = parts(now, timeZone);
  const today = zonedToUtc(p.year, p.month, p.day, hour, minute, timeZone);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedToUtc(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    hour,
    minute,
    timeZone,
  );
}
