-- Cursor pagination indexes for chat history (run in Supabase SQL editor)
CREATE INDEX IF NOT EXISTS idx_messages_group_cursor
ON public.messages (group_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_dm_pair_cursor
ON public.messages (user_id, recipient_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_team_cursor
ON public.messages (created_at DESC, id DESC)
WHERE recipient_id IS NULL AND group_id IS NULL;

-- Verify plan: should prefer Index Scan, not Seq Scan
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT m.id, m.content, m.created_at, m.user_id, m.recipient_id, m.group_id
FROM public.messages m
WHERE m.group_id = 1
  AND (m.created_at, m.id) < ('2026-05-09T10:00:00Z'::timestamptz, 999999::int)
ORDER BY m.created_at DESC, m.id DESC
LIMIT 50;
