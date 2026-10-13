const TZ = 'Asia/Almaty';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
const dateYearFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00` : value) : value;
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateYearFmt.format(d);
}

export const formatTime = (value: string) => timeFmt.format(new Date(value));

/** "августа 2026 г." — genitive month for phrases like "на TAPTIM с …". */
export const formatSinceMonth = (value: string) =>
  dateYearFmt
    .format(new Date(value))
    .replace(/^\d+\s/, '')
    .replace(/\s?г\.$/, '');

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '';
  const diff = Math.round((now - new Date(value).getTime()) / 1000);
  if (diff < 60) return 'только что';
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return formatDate(value);
}

/** YYYY-MM-DD in Almaty time (for <input type="date"> bounds). */
export function isoDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** Render-time check: has the ISO timestamp passed? */
export const isExpired = (iso: string | null | undefined) =>
  Boolean(iso && new Date(iso).getTime() < Date.now());

export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
