// Only public, VITE_-prefixed values. Secrets never reach the browser bundle.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const env = {
  supabaseUrl: url ?? '',
  supabaseKey: key ?? '',
  mapProvider: (import.meta.env.VITE_MAP_PROVIDER as string | undefined) ?? '',
  mapApiKey: (import.meta.env.VITE_MAP_API_KEY as string | undefined) ?? '',
};

export const isConfigured = Boolean(url && key && /^https?:\/\//.test(url));

// Defensive: refuse to start if someone put a service-role / secret key into the frontend env.
export const looksLikeSecretKey = (k: string) => {
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
};
