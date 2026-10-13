import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database, Tables } from '@/lib/database.types';
import { functionErrorCode, messageForCode } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export type PrivateSettings = Tables<'profile_private'>;
export type Notification = Tables<'notifications'>;
export type Report = Tables<'reports'>;

export function usePublicProfile(id: string | undefined) {
  return useQuery({
    queryKey: ['public-profile', id],
    enabled: Boolean(id),
    queryFn: async () => {
      // explicit column list: public fields only
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_path, bio, city_id, created_at, is_deleted')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (
      v: Pick<Database['public']['Tables']['profiles']['Update'], 'display_name' | 'bio' | 'city_id'>,
    ) => {
      const { error } = await supabase.from('profiles').update(v).eq('id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function usePrivateSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['private-settings', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_private')
        .select('*')
        .eq('user_id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

type SettingsPatch = Partial<
  Pick<
    PrivateSettings,
    | 'notify_messages'
    | 'notify_requests'
    | 'notify_offers'
    | 'notify_listing_updates'
    | 'notify_reports'
    | 'messages_from'
  >
>;

export function useUpdatePrivateSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const { error } = await supabase.from('profile_private').update(patch).eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['private-settings'] }),
  });
}

// ───────────── Blocks ─────────────
export function useBlocks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blocks', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('blocks').select('blocked_id, created_at');
      if (error) throw error;
      if (!data.length) return [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_path')
        .in(
          'id',
          data.map((b) => b.blocked_id),
        );
      const m = new Map((profiles ?? []).map((p) => [p.id, p]));
      return data.map((b) => ({ ...b, profile: m.get(b.blocked_id) ?? null }));
    },
  });
}

export function useSetBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, block }: { userId: string; block: boolean }) => {
      const { error } = block
        ? await supabase.from('blocks').insert({ blocked_id: userId })
        : await supabase.from('blocks').delete().eq('blocked_id', userId);
      if (error && error.code !== '23505') throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ───────────── Notifications ─────────────
export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useUnreadNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications-unread', user?.id],
    enabled: Boolean(user),
    refetchInterval: 120_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | 'all') => {
      let q = supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
      if (ids !== 'all') q = q.in('id', ids);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });
}

// ───────────── Reports & appeals ─────────────
export type ReportInput =
  | { target_type: 'listing'; listing_id: string }
  | { target_type: 'user'; target_user_id: string }
  | { target_type: 'message'; message_id: string };

export function useCreateReport() {
  return useMutation({
    mutationFn: async (v: ReportInput & { reason: Report['reason']; description: string }) => {
      const { error } = await supabase
        .from('reports')
        .insert({ ...v, description: v.description.trim() || null });
      if (error) throw error;
    },
  });
}

export function useMyReports() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-reports', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, target_type, reason, description, status, info_request, reporter_reply, created_at, updated_at',
        )
        .eq('reporter_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useReplyToReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; text: string }) => {
      const { error } = await supabase.rpc('reply_to_report', { p_report: v.id, p_text: v.text });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-reports'] }),
  });
}

export function useCreateAppeal() {
  return useMutation({
    mutationFn: async (v: { listing_id?: string; restriction_id?: string; message: string }) => {
      const { error } = await supabase.from('appeals').insert(v);
      if (error) throw error;
    },
  });
}

export function useMyAppeals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-appeals', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('appeals').select('*').eq('user_id', user!.id);
      if (error) throw error;
      return data;
    },
  });
}

// ───────────── Account deletion ─────────────
export async function deleteAccount(confirm: string) {
  const { error } = await supabase.functions.invoke('delete-account', { body: { confirm } });
  if (error) throw new Error(messageForCode(await functionErrorCode(error)));
  await supabase.auth.signOut({ scope: 'local' });
}
