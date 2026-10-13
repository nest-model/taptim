import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export type Message = Tables<'messages'> & { pending?: boolean; failed?: boolean };
const PAGE = 40;

export function useConversations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['conversations', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_conversations', { p_limit: 100 });
      if (error) throw error;
      return data;
    },
  });
}

export function useUnreadMessages() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['unread-messages', user?.id],
    enabled: Boolean(user),
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('unread_messages_count');
      if (error) throw error;
      return data;
    },
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ['conversation', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('conversations').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Pages are newest-first from the server; the UI reverses them. Cursor = created_at of the oldest loaded. */
export function useMessages(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    enabled: Boolean(conversationId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data as Message[];
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.created_at : undefined),
  });
}

type Pages = InfiniteData<Message[], string | null>;

function upsertMessage(qc: ReturnType<typeof useQueryClient>, conversationId: string, msg: Message) {
  qc.setQueryData<Pages>(['messages', conversationId], (old) => {
    if (!old) return old;
    const pages = old.pages.map((p) => p.filter((m) => m.client_id !== msg.client_id && m.id !== msg.id));
    pages[0] = [msg, ...(pages[0] ?? [])];
    return { ...old, pages };
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ body, clientId }: { body: string; clientId: string }) => {
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: conversationId, body, client_id: clientId })
        .select('*')
        .single();
      if (error?.code === '23505') {
        // retry after a lost response: the message is already stored
        const { data: existing } = await supabase
          .from('messages')
          .select('*')
          .eq('client_id', clientId)
          .single();
        return existing as Message;
      }
      if (error) throw error;
      return data as Message;
    },
    onMutate: ({ body, clientId }) => {
      upsertMessage(qc, conversationId, {
        id: clientId,
        client_id: clientId,
        conversation_id: conversationId,
        sender_id: user!.id,
        body,
        created_at: new Date().toISOString(),
        pending: true,
      });
    },
    onSuccess: (msg) => {
      upsertMessage(qc, conversationId, msg);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (_e, { body, clientId }) => {
      upsertMessage(qc, conversationId, {
        id: clientId,
        client_id: clientId,
        conversation_id: conversationId,
        sender_id: user!.id,
        body,
        created_at: new Date().toISOString(),
        failed: true,
      });
    },
  });
}

export function useStartConversation() {
  return useMutation({
    mutationFn: async (v: { listingId: string; otherId?: string }) => {
      const { data, error } = await supabase.rpc('start_conversation', {
        p_listing: v.listingId,
        p_other: v.otherId,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unread-messages'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * One realtime channel per signed-in user. Postgres Changes are filtered by RLS on the server,
 * so the client only ever receives rows it may read (its own chats & notifications).
 */
export function useRealtimeInbox(onMessage?: (m: Message) => void) {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`inbox:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Message;
        upsertMessage(qc, m.conversation_id, m);
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['unread-messages'] });
        onMessage?.(m);
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['notifications'] });
          qc.invalidateQueries({ queryKey: ['notifications-unread'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc, onMessage]);
}
