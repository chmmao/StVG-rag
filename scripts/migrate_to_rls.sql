-- ============================================================
-- SAFE MIGRATION: Upgrade to README-Spec Schema
-- This script is NON-DESTRUCTIVE. It does NOT drop any data.
-- Run this ONCE in the Supabase SQL Editor.
-- ============================================================

-- [Step 1] Enable Row Level Security on existing table
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- [Step 2] Create tenant isolation policy (only affects anon role)
-- DROP first in case a partial policy exists
DROP POLICY IF EXISTS tenant_isolation ON public.documents;
CREATE POLICY tenant_isolation 
ON public.documents 
FOR SELECT 
TO anon 
USING ( 
    metadata->>'tenant_id' = current_setting('app.current_tenant', true)
);

-- [Step 3] Replace the old function with the full-spec version
-- This safely overwrites the old signature with the new one.
-- Existing data is completely untouched.
DROP FUNCTION IF EXISTS match_documents(vector(3072), int, text);
DROP FUNCTION IF EXISTS match_documents(vector(768), int, text);
DROP FUNCTION IF EXISTS match_documents(vector, float, int, text);

CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector,
  match_threshold float,
  match_count int,
  filter_tenant_id text
) RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Inject the requested tenant into Postgres transaction context
  PERFORM set_config('app.current_tenant', filter_tenant_id, true);
  
  -- Cosine similarity with threshold circuit breaker
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  FROM public.documents d
  WHERE 1 - (d.embedding <=> query_embedding) >= match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- [Step 4] Verification query (run separately after migration)
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'documents';
-- Expected: true
