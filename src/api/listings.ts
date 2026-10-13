import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS, type ListingType } from '@/config/listing';
import type { Database, Tables, Views } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export type Listing = Tables<'listings'>;
export type ListingCard = Views<'listing_cards'>;
export type ListingPhoto = Tables<'listing_photos'>;
export type ListingInsert = Database['public']['Tables']['listings']['Insert'];
export type ListingUpdate = Database['public']['Tables']['listings']['Update'];

export interface SearchParams {
  q?: string;
  types?: ListingType[];
  category?: string;
  district?: string;
  city: string;
  dateFrom?: string;
  dateTo?: string;
  includeClosed?: boolean;
  sort?: 'new' | 'relevance' | 'event_date';
  withPhoto?: boolean;
}

/** Server-side search with offset pagination ("Показать ещё"). */
export function useSearchListings(p: SearchParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['search', p],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('search_listings', {
        p_query: p.q || undefined,
        p_types: p.types?.length ? p.types : undefined,
        p_category: p.category || undefined,
        p_district: p.district || undefined,
        p_city: p.city,
        p_date_from: p.dateFrom || undefined,
        p_date_to: p.dateTo || undefined,
        p_include_closed: p.includeClosed ?? false,
        p_sort: p.sort ?? (p.q ? 'relevance' : 'new'),
        p_limit: LIMITS.pageSize,
        p_offset: pageParam,
        p_with_photo: p.withPhoto ?? false,
      });
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last, all) =>
      last.length === LIMITS.pageSize ? all.length * LIMITS.pageSize : undefined,
  });
}

export function useListing(id: string | undefined) {
  return useQuery({
    queryKey: ['listing', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [l, photos] = await Promise.all([
        supabase.from('listings').select('*').eq('id', id!).maybeSingle(),
        supabase.from('listing_photos').select('*').eq('listing_id', id!).order('sort').order('created_at'),
      ]);
      if (l.error) throw l.error;
      if (photos.error) throw photos.error;
      if (!l.data) return null;
      const author = await supabase
        .from('profiles')
        .select('id, display_name, avatar_path, created_at, is_deleted')
        .eq('id', l.data.author_id)
        .maybeSingle();
      if (author.error) throw author.error;
      return { listing: l.data, photos: photos.data, author: author.data };
    },
  });
}

/** "Похожие объявления": same category and type, excluding the current one. */
export function useSimilarListings(l: Pick<Listing, 'id' | 'type' | 'category_id' | 'city_id'> | undefined) {
  return useQuery({
    queryKey: ['similar', l?.id],
    enabled: Boolean(l?.category_id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_listings', {
        p_types: [l!.type],
        p_category: l!.category_id!,
        p_city: l!.city_id,
        p_exclude: l!.id,
        p_limit: 10,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useMyListings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-listings', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listing_cards')
        .select('*')
        .eq('author_id', user!.id)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
}

export function useUserListings(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-listings', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listing_cards')
        .select('*')
        .eq('author_id', userId!)
        .in('status', ['active', 'reserved'])
        .eq('moderation_state', 'ok')
        .gt('expires_at', new Date().toISOString())
        .order('published_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

export function useListingMatches(listing: Listing | undefined, isOwner: boolean) {
  return useQuery({
    queryKey: ['matches', listing?.id],
    enabled: Boolean(listing && isOwner && ['active', 'reserved'].includes(listing.status)),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('listing_matches', { p_listing: listing!.id, p_limit: 6 });
      if (error) throw error;
      return data;
    },
  });
}

export function useRecommended() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['recommended', user?.id],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recommended_listings', { p_limit: 8 });
      if (error) throw error;
      return data;
    },
  });
}

// ───────────── Favorites ─────────────
export function useFavoriteIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['favorite-ids', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('favorites').select('listing_id').limit(1000);
      if (error) throw error;
      return new Set(data.map((f) => f.listing_id));
    },
  });
}

export function useFavorites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['favorites', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data: favs, error } = await supabase
        .from('favorites')
        .select('listing_id, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (!favs.length) return [];
      const { data, error: e2 } = await supabase
        .from('listing_cards')
        .select('*')
        .in(
          'id',
          favs.map((f) => f.listing_id),
        );
      if (e2) throw e2;
      const order = new Map(favs.map((f, i) => [f.listing_id, i]));
      return data.sort((a, b) => (order.get(a.id!) ?? 0) - (order.get(b.id!) ?? 0));
    },
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = on
        ? await supabase.from('favorites').insert({ listing_id: id })
        : await supabase.from('favorites').delete().eq('listing_id', id);
      if (error && error.code !== '23505') throw error;
    },
    onMutate: async ({ id, on }) => {
      const key = ['favorite-ids', user?.id];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Set<string>>(key);
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      qc.setQueryData(key, next);
      return { prev, key };
    },
    onError: (_e, _v, ctx) => ctx && qc.setQueryData(ctx.key, ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['favorites'] });
      qc.invalidateQueries({ queryKey: ['recommended'] });
    },
  });
}

// ───────────── Mutations ─────────────
function invalidateListing(qc: ReturnType<typeof useQueryClient>, id?: string) {
  if (id) qc.invalidateQueries({ queryKey: ['listing', id] });
  qc.invalidateQueries({ queryKey: ['my-listings'] });
  qc.invalidateQueries({ queryKey: ['search'] });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: ListingInsert) => {
      const { data, error } = await supabase.from('listings').insert(values).select('*').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (l) => invalidateListing(qc, l.id),
  });
}

export function useUpdateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ListingUpdate }) => {
      const { data, error } = await supabase
        .from('listings')
        .update(values)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (l) => invalidateListing(qc, l.id),
  });
}

export function useRepublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('republish_listing', { p_id: id });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => invalidateListing(qc, id),
  });
}

export function useDeleteListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (l: Pick<Listing, 'id' | 'status'>) => {
      if (l.status === 'draft') {
        // drafts are hard-deleted: remove their photo files first
        await supabase.functions.invoke('photos', { body: { action: 'purge_draft', listing_id: l.id } });
      }
      const { error } = await supabase.rpc('delete_my_listing', { p_id: l.id });
      if (error) throw error;
      return l.id;
    },
    onSuccess: (id) => {
      qc.removeQueries({ queryKey: ['listing', id] });
      invalidateListing(qc);
    },
  });
}
