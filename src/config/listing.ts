import { ArrowLeftRight, Gift, HandHeart, PackageSearch, SearchCheck, type LucideIcon } from 'lucide-react';
import type { Enums } from '@/lib/database.types';

export type ListingType = Enums<'listing_type'>;
export type ListingStatus = Enums<'listing_status'>;
export type ItemCondition = Enums<'item_condition'>;

export const LISTING_TYPES: ListingType[] = ['lost', 'found', 'giveaway', 'exchange', 'wanted'];
export const CONDITIONS: ItemCondition[] = ['new', 'good', 'used', 'for_parts'];

export const TYPE_ICON: Record<ListingType, LucideIcon> = {
  lost: PackageSearch,
  found: HandHeart,
  giveaway: Gift,
  exchange: ArrowLeftRight,
  wanted: SearchCheck,
};

/** URL slug of each feed. */
export const TYPE_PATH: Record<ListingType, string> = {
  lost: '/lost',
  found: '/found',
  giveaway: '/free',
  exchange: '/exchange',
  wanted: '/wanted',
};

/** Mirrors server limits (the server is the source of truth; these only give early feedback). */
export const LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descriptionMin: 10,
  descriptionMax: 3000,
  placeMax: 120,
  exchangeWishMin: 3,
  exchangeWishMax: 500,
  quantityMax: 50,
  photosMax: 5,
  photoInputMaxBytes: 15 * 1024 * 1024,
  photoMaxSide: 1280,
  thumbMaxSide: 400,
  messageMax: 2000,
  reportMax: 1000,
  bioMax: 300,
  displayNameMin: 2,
  displayNameMax: 40,
  wantedMaxDays: 90,
  eventMaxDaysAgo: 365,
  pageSize: 20,
} as const;

export const TERMS_VERSION = '2026-10-13';
export const DEFAULT_CITY = 'shymkent';
