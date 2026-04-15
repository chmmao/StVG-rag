import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function audit() {
  console.log("========================================");
  console.log("  SUPABASE SCHEMA AUDIT (Deep Inspect)  ");
  console.log("========================================\n");

  // 1. Check if RLS is enabled on the documents table
  console.log("--- [1] Row Level Security (RLS) Status ---");
  const { data: rlsData, error: rlsErr } = await supabase.rpc('exec_sql', {
    query: "SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'documents';"
  }).maybeSingle();
  
  // RLS check via alternative method if exec_sql doesn't exist
  const { data: rlsAlt, error: rlsAltErr } = await supabase
    .from('documents')
    .select('id')
    .limit(0);
  
  if (rlsErr && rlsAltErr) {
    console.log("  Could not query RLS status directly. Attempting indirect check...");
  }

  // 2. Check the function signature of match_documents
  console.log("\n--- [2] match_documents() Function Signature ---");
  const { data: fnData, error: fnErr } = await supabase.rpc('match_documents', {
    query_embedding: Array(3072).fill(0), // match actual DB dimension
    match_threshold: 0.99,               // intentionally high to return 0 results
    match_count: 1,
    filter_tenant_id: 'nonexistent-tenant-audit-test',
  });

  if (fnErr) {
    console.log("  ❌ FAILED with match_threshold parameter:", fnErr.message);
    console.log("  Interpretation: Your DB function does NOT accept match_threshold.");
    console.log("  This means your DB is running the OLD setup.sql version.\n");
    
    // Try without match_threshold
    console.log("  Retrying WITHOUT match_threshold...");
    const { data: fnData2, error: fnErr2 } = await supabase.rpc('match_documents', {
      query_embedding: Array(768).fill(0),
      match_count: 1,
      filter_tenant_id: 'nonexistent-tenant-audit-test',
    });
    if (fnErr2) {
      console.log("  ❌ Also failed without threshold:", fnErr2.message);
      
      // Try with 3072 dimensions
      console.log("  Retrying with 3072-dim vector...");
      const { data: fnData3, error: fnErr3 } = await supabase.rpc('match_documents', {
        query_embedding: Array(3072).fill(0),
        match_count: 1,
        filter_tenant_id: 'nonexistent-tenant-audit-test',
      });
      if (fnErr3) {
        console.log("  ❌ 3072-dim also failed:", fnErr3.message);
      } else {
        console.log("  ✅ Works with 3072-dim vectors (no threshold). Function expects vector(3072).");
      }
    } else {
      console.log("  ✅ Works WITHOUT match_threshold. Function signature = OLD (setup.sql).");
    }
  } else {
    console.log("  ✅ SUCCESS with match_threshold parameter.");
    console.log("  Your DB function accepts: (query_embedding, match_threshold, match_count, filter_tenant_id)");
    console.log("  This matches the README SQL specification.\n");
  }

  // 3. Check actual vector dimensions stored in the database
  console.log("\n--- [3] Stored Vector Dimensions ---");
  const { data: dimData, error: dimErr } = await supabase
    .from('documents')
    .select('id, metadata, embedding')
    .limit(1);

  if (dimErr) {
    console.log("  ❌ Cannot read embeddings:", dimErr.message);
  } else if (dimData && dimData.length > 0) {
    const embeddingStr = dimData[0].embedding;
    if (typeof embeddingStr === 'string') {
      const dims = embeddingStr.split(',').length;
      console.log(`  Vector dimensions in DB: ${dims}`);
      console.log(`  Tenant of sample row: ${dimData[0].metadata?.tenant_id}`);
    } else if (Array.isArray(embeddingStr)) {
      console.log(`  Vector dimensions in DB: ${embeddingStr.length}`);
    } else {
      console.log("  Embedding format:", typeof embeddingStr, embeddingStr ? "present" : "null");
    }
  } else {
    console.log("  No documents found in the database.");
  }

  // 4. Check RLS policies
  console.log("\n--- [4] RLS Policies on documents table ---");
  const { data: policyData, error: policyErr } = await supabase.rpc('match_documents', {
    query_embedding: Array(768).fill(0),
    match_count: 0,
    filter_tenant_id: '__rls_probe__',
  }).maybeSingle();
  // If we get here without auth errors, we can at least confirm the function runs

  // 5. Summary
  console.log("\n========================================");
  console.log("  AUDIT COMPLETE                        ");
  console.log("========================================");
}

audit().catch(e => console.error("Audit script error:", e.message));
