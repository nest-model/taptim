import { env } from '../env';

/**
 * Map provider abstraction. The app works fully without a map (district selection).
 * To add a provider (2GIS, Yandex, OSM/Leaflet), implement MapProvider and register it below.
 * Rules: never send exact private coordinates; only approximate district-level points;
 * disclose the provider in the privacy policy; do not enable paid APIs silently.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapProvider {
  id: string;
  /** Human-readable name for the privacy disclosure. */
  name: string;
  /** Mounts an interactive map showing approximate markers; returns a cleanup function. */
  mount(el: HTMLElement, opts: { center: LatLng; zoom: number; markers: LatLng[] }): () => void;
}

const registry: Record<string, () => Promise<MapProvider>> = {
  // example: '2gis': () => import('./providers/dgis').then((m) => m.default),
};

export async function getMapProvider(): Promise<MapProvider | null> {
  const id = env.mapProvider;
  if (!id || !env.mapApiKey || !registry[id]) return null;
  return registry[id]();
}

/** Rounds coordinates to ~1 km so a home address can never be derived from a public point. */
export const coarsen = (p: LatLng): LatLng => ({
  lat: Math.round(p.lat * 100) / 100,
  lng: Math.round(p.lng * 100) / 100,
});
