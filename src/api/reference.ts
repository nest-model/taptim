import { useQuery } from '@tanstack/react-query';
import type { ListingType } from '@/config/listing';
import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type Category = Tables<'categories'>;
export type District = Tables<'districts'>;
export type City = Tables<'cities'>;

const HOUR = 60 * 60_000;

export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    staleTime: HOUR,
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('sort');
      if (error) throw error;
      return data;
    },
  });
}

export function useDistricts(cityId: string) {
  return useQuery({
    queryKey: ['districts', cityId],
    staleTime: HOUR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('districts')
        .select('*')
        .eq('city_id', cityId)
        .order('sort');
      if (error) throw error;
      return data;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: HOUR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data;
    },
  });
}

export const categoriesFor = (all: Category[] | undefined, type: ListingType | null) =>
  (all ?? []).filter((c) => !type || c.listing_types.includes(type));

export const byId = <T extends { id: string }>(rows: T[] | undefined) =>
  new Map((rows ?? []).map((r) => [r.id, r] as const));
