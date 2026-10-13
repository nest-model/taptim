import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export type GiveawayRequest = Tables<'giveaway_requests'>;
export type ExchangeOffer = Tables<'exchange_offers'>;
export type OwnershipClaim = Tables<'ownership_claims'>;

type WithName<T> = T & { party_name: string; party_deleted: boolean };

async function attachNames<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): Promise<WithName<T>[]> {
  const ids = [...new Set(rows.map((r) => r[key] as string))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_deleted')
    .in('id', ids);
  if (error) throw error;
  const m = new Map(data.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    party_name: m.get(r[key] as string)?.display_name ?? '',
    party_deleted: m.get(r[key] as string)?.is_deleted ?? false,
  }));
}

/** Everything attached to a listing that the caller may see (RLS decides: author sees all, others see own). */
export function useListingInteractions(listingId: string | undefined, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['interactions', listingId, user?.id],
    enabled: Boolean(listingId && user && enabled),
    queryFn: async () => {
      const [r, o, c] = await Promise.all([
        supabase.from('giveaway_requests').select('*').eq('listing_id', listingId!).order('created_at'),
        supabase.from('exchange_offers').select('*').eq('listing_id', listingId!).order('created_at'),
        supabase.from('ownership_claims').select('*').eq('listing_id', listingId!).order('created_at'),
      ]);
      if (r.error) throw r.error;
      if (o.error) throw o.error;
      if (c.error) throw c.error;
      return {
        requests: await attachNames(r.data, 'requester_id'),
        offers: await attachNames(o.data, 'offerer_id'),
        claims: await attachNames(c.data, 'claimant_id'),
      };
    },
  });
}

export function useQueuePosition(requestId: string | undefined) {
  return useQuery({
    queryKey: ['queue-position', requestId],
    enabled: Boolean(requestId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('giveaway_queue_position', { p_request: requestId! });
      if (error) throw error;
      return data;
    },
  });
}

export function useMyActivity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-activity', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const uid = user!.id;
      const [r, o, c] = await Promise.all([
        supabase
          .from('giveaway_requests')
          .select('*')
          .eq('requester_id', uid)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('exchange_offers')
          .select('*')
          .eq('offerer_id', uid)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('ownership_claims')
          .select('*')
          .eq('claimant_id', uid)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (r.error) throw r.error;
      if (o.error) throw o.error;
      if (c.error) throw c.error;
      const ids = [...new Set([...r.data, ...o.data, ...c.data].map((x) => x.listing_id))];
      const titles = new Map<string, string>();
      if (ids.length) {
        const { data } = await supabase.from('listing_cards').select('id, title').in('id', ids);
        data?.forEach((l) => l.id && titles.set(l.id, l.title ?? ''));
      }
      return { requests: r.data, offers: o.data, claims: c.data, titles };
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (listingId?: string) => {
    qc.invalidateQueries({ queryKey: ['interactions', listingId] });
    qc.invalidateQueries({ queryKey: ['listing', listingId] });
    qc.invalidateQueries({ queryKey: ['my-activity'] });
    qc.invalidateQueries({ queryKey: ['queue-position'] });
  };
}

export function useCreateRequest() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (v: { listing_id: string; message: string }) => {
      const { error } = await supabase
        .from('giveaway_requests')
        .insert({ listing_id: v.listing_id, message: v.message.trim() || null });
      if (error) throw error;
      return v.listing_id;
    },
    onSuccess: inv,
  });
}

export function useCreateOffer() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (v: { listing_id: string; message: string; offered_listing_id: string | null }) => {
      const { error } = await supabase.from('exchange_offers').insert(v);
      if (error) throw error;
      return v.listing_id;
    },
    onSuccess: inv,
  });
}

export function useCreateClaim() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (v: { listing_id: string; proof: string }) => {
      const { error } = await supabase.from('ownership_claims').insert(v);
      if (error) throw error;
      return v.listing_id;
    },
    onSuccess: inv,
  });
}

export function useInteractionAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (v: {
      kind: 'request' | 'offer' | 'claim';
      id: string;
      action: string;
      listingId: string;
    }) => {
      const { error } =
        v.kind === 'request'
          ? await supabase.rpc('giveaway_request_action', { p_request: v.id, p_action: v.action })
          : v.kind === 'offer'
            ? await supabase.rpc('exchange_offer_action', { p_offer: v.id, p_action: v.action })
            : await supabase.rpc('ownership_claim_action', { p_claim: v.id, p_action: v.action });
      if (error) throw error;
      return v.listingId;
    },
    onSuccess: inv,
  });
}
