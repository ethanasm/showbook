export interface IcsEvent {
  uid: string;
  summary: string;
  /** Floating local start — interpreted in the importing calendar's timezone */
  dtstart: Date;
  /** Floating local end */
  dtend: Date;
  location?: string;
  description?: string;
  url?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime(d: Date): string {
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function formatUtc(d: Date): string {
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    const size = i === 0 ? 75 : 74;
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + size));
    i += size;
  }
  return parts.join('\r\n');
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

export function buildIcs(events: IcsEvent[]): string {
  const out: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Showbook//Showbook//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const now = new Date();
  for (const ev of events) {
    out.push('BEGIN:VEVENT');
    out.push(prop('UID', ev.uid));
    out.push(prop('DTSTAMP', formatUtc(now)));
    out.push(prop('DTSTART', formatLocalDateTime(ev.dtstart)));
    out.push(prop('DTEND', formatLocalDateTime(ev.dtend)));
    out.push(prop('SUMMARY', escapeText(ev.summary)));
    if (ev.location) out.push(prop('LOCATION', escapeText(ev.location)));
    if (ev.description) out.push(prop('DESCRIPTION', escapeText(ev.description)));
    if (ev.url) out.push(prop('URL', ev.url));
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

/** 7pm local on the given YYYY-MM-DD, 3-hour duration. */
export function defaultShowTime(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 19, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return { start, end };
}

export function slugifyForFilename(value: string): string {
  // Cap input before any regex pass so unbounded user-supplied strings can't
  // drive worst-case backtracking; the final slice is just to enforce the
  // output cap after collapsing runs of non-alphanumerics.
  const bounded = value.slice(0, 200);
  return (
    bounded
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'event'
  );
}
