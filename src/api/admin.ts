import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Enums } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

// Every function here is re-authorised in the database (assert_moderator / is_admin).

export interface DashboardStats {
  users_total: number;
  users_7d: number;
  listings_active: Partial<Record<Enums<'listing_type'>, number>>;
  listings_7d: number;
  listings_pending_review: number;
  listings_hidden: number;
  resolved_30d: Partial<Record<Enums<'listing_type'>, number>>;
  reports_open: number;
  reports_7d: number;
  appeals_open: number;
  restrictions_active: number;
}

export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_dashboard');
      if (error) throw error;
      return data as unknown as DashboardStats;
    },
  });
}

export function useAdminReports(status: Enums<'report_status'>[]) {
  return useQuery({
    queryKey: ['admin', 'reports', status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_reports', { p_status: status, p_limit: 100 });
      if (error) throw error;
      return data;
    },
  });
}

export interface ReportContext {
  messages?: {
    id: string;
    sender_id: string;
    sender_name: string;
    body: string;
    created_at: string;
    is_reported: boolean;
  }[];
  notes: { body: string; author: string; created_at: string }[];
  actions: { action: string; reason: string | null; created_at: string }[];
}

export function useReportContext(id: string | null, withMessages: boolean) {
  return useQuery({
    queryKey: ['admin', 'report-context', id, withMessages],
    enabled: Boolean(id && withMessages),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_report_context', { p_report: id! });
      if (error) throw error;
      return data as unknown as ReportContext;
    },
  });
}

export interface AdminListingFilter {
  state?: Enums<'moderation_state'> | '';
  q?: string;
}

export function useAdminListings(f: AdminListingFilter) {
  return useQuery({
    queryKey: ['admin', 'listings', f],
    queryFn: async () => {
      let q = supabase
        .from('listing_cards')
        .select('*')
        .neq('status', 'draft')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (f.state) q = q.eq('moderation_state', f.state);
      if (f.q?.trim()) {
        const term = f.q.trim().replace(/[%_\\,()]/g, ' ');
        q = q.ilike('title', `%${term}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminUsers(query: string) {
  return useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_search_users', {
        p_query: query || undefined,
        p_limit: 50,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useUserRestrictions(userId: string | null) {
  return useQuery({
    queryKey: ['admin', 'restrictions', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_user_restrictions', { p_user: userId! });
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminAppeals() {
  return useQuery({
    queryKey: ['admin', 'appeals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appeals')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useModerationLog() {
  return useQuery({
    queryKey: ['admin', 'log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('moderation_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const ids = [
        ...new Set(data.flatMap((a) => [a.moderator_id, a.target_user_id]).filter(Boolean) as string[]),
      ];
      const { data: profiles } = ids.length
        ? await supabase.from('profiles').select('id, display_name').in('id', ids)
        : { data: [] };
      const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
      return data.map((a) => ({
        ...a,
        moderator_name: a.moderator_id ? (names.get(a.moderator_id) ?? '') : 'Система',
        target_name: a.target_user_id ? (names.get(a.target_user_id) ?? '') : '',
      }));
    },
  });
}

function useAdminMutation<V>(fn: (v: V) => PromiseLike<{ error: unknown }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      const { error } = await fn(v);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export const useUpdateReport = () =>
  useAdminMutation((v: { id: string; status: Enums<'report_status'>; note?: string; infoRequest?: string }) =>
    supabase.rpc('admin_update_report', {
      p_report: v.id,
      p_status: v.status,
      p_note: v.note || undefined,
      p_info_request: v.infoRequest || undefined,
    }),
  );

export const useSetListingState = () =>
  useAdminMutation((v: { id: string; state: Enums<'moderation_state'>; reason: string; reportId?: string }) =>
    supabase.rpc('admin_set_listing_state', {
      p_listing: v.id,
      p_state: v.state,
      p_reason: v.reason,
      p_report: v.reportId,
    }),
  );

export const useRestrictUser = () =>
  useAdminMutation(
    (v: {
      userId: string;
      kind: Enums<'restriction_kind'>;
      reason: string;
      expiresAt?: string;
      reportId?: string;
    }) =>
      supabase.rpc('admin_restrict_user', {
        p_user: v.userId,
        p_kind: v.kind,
        p_reason: v.reason,
        p_expires_at: v.expiresAt,
        p_report: v.reportId,
      }),
  );

export const useLiftRestriction = () =>
  useAdminMutation((v: { id: string; reason: string }) =>
    supabase.rpc('admin_lift_restriction', { p_restriction: v.id, p_reason: v.reason }),
  );

export const useSetRole = () =>
  useAdminMutation((v: { userId: string; role: Enums<'app_role'>; grant: boolean }) =>
    supabase.rpc('admin_set_role', { p_user: v.userId, p_role: v.role, p_grant: v.grant }),
  );

export const useDecideAppeal = () =>
  useAdminMutation((v: { id: string; accept: boolean; note: string }) =>
    supabase.rpc('admin_decide_appeal', { p_appeal: v.id, p_accept: v.accept, p_note: v.note }),
  );
