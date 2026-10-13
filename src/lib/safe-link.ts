/**
 * Only same-app relative paths are allowed as navigation targets coming from data
 * (notifications, ?next= redirects). Blocks open redirects and `javascript:` URLs.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 32) return fallback;
  try {
    const u = new URL(value, 'https://taptim.local');
    if (u.origin !== 'https://taptim.local') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/** Finds URLs in user text so they can be shown as inert, clearly-marked text (never auto-linked). */
export const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
export const containsUrl = (text: string) => new RegExp(URL_RE.source, 'i').test(text);
