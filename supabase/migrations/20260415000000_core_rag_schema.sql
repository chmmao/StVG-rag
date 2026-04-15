-- ========================================================================================
-- Phase 3: Dynamic Architecture Implementation
-- ========================================================================================

-- Enable pgvector plugin
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop prior structures if they exist since we are executing a major architectural refactor
DROP TABLE IF EXISTS public.documents CASCADE;

-- Create the foundational data table WITHOUT a hardcoded vector dimension (e.g. vector(3072)).
-- Notice the dimension isolation abstraction: "embedding vector" simply defined as vector.
CREATE TABLE public.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content text NOT NULL,
    metadata jsonb,
    embedding vector 
);

-- ========================================================================================
-- Phase 1 & 4: Security Boundaries, Transactional RLS, and Cosine Thresholding
-- ========================================================================================

-- Enable Row Level Security natively
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Formulate the mathematical interception policy
-- NOTE: Targeted squarely at 'TO anon' enforcing restriction strictly on unauthenticated API layer queries
CREATE POLICY tenant_isolation 
ON public.documents 
FOR SELECT 
TO anon 
USING ( 
    metadata->>'tenant_id' = current_setting('app.current_tenant', true)
);

-- Migrate and redefine the similarity matcher
-- Included modifications: match_threshold implementation & context invocation dynamic shifting
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
SECURITY INVOKER  -- [CRITICAL]: Forces execution under calling context (anon). Honors RLS!
AS $$
BEGIN
  -- [SECURITY ABSTRACTION]: Inject the token payload into the kernel's transaction context variables instantly
  PERFORM set_config('app.current_tenant', filter_tenant_id, true);
  
  -- [RETRIEVAL LOGIC]: Calculate Cosine Distance via <EUC> similarity execution.
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  FROM public.documents d
  -- [CIRCUIT BREAKER]: Physical mathematical cut-off for the vector threshold (e.g. 0.65 check occurs here)
  WHERE 1 - (d.embedding <=> query_embedding) >= match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
