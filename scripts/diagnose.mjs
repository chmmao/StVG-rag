/**
 * Health Check — Automated CI-ready diagnostic for the RAG pipeline.
 *
 * Verifies:
 *  1. Database connectivity & row count
 *  2. Embedding API availability & dimension match (3072)
 *  3. RPC match_documents functionality
 *  4. Tenant isolation (RLS enforcement)
 *
 * Exit codes: 0 = all pass, 1 = failure detected
 * Usage: node scripts/diagnose.mjs  (or: npm run health)
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Service Role client (God-Mode) — for general diagnostics
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// Anon client — subject to RLS, mirrors the production runtime in route.ts
const supabaseAnon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const EXPECTED_DIMENSIONS = 3072;
let failures = 0;

function pass(label) { console.log(`  ✅ PASS: ${label}`); }
function fail(label, detail) {
  console.error(`  ❌ FAIL: ${label} — ${detail}`);
  failures++;
}

async function diagnose() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   RAG Pipeline Health Check (v2)     ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Test 1: Database Connectivity ──
  console.log("1. Database Connectivity...");
  const { data: countData, error: countErr } = await supabase
    .from('documents')
    .select('id, metadata', { count: 'exact', head: false })
    .limit(5);

  if (countErr) {
    fail("DB Connection", countErr.message);
  } else {
    pass(`Connected. Sample rows returned: ${countData.length}`);
    if (countData.length > 0 && countData[0].metadata) {
      console.log(`     Sample tenant: ${countData[0].metadata.tenant_id || 'N/A'}`);
    }
  }

  // ── Test 2: Embedding API & Dimension Validation ──
  console.log("\n2. Embedding API & Dimension Match...");
  let testVector = null;
  try {
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: 'Health check test vector' }] },
        }),
      }
    );

    if (!embedRes.ok) {
      fail("Embedding API", `HTTP ${embedRes.status}: ${await embedRes.text()}`);
    } else {
      const embedData = await embedRes.json();
      testVector = embedData.embedding?.values;

      if (!testVector) {
        fail("Embedding API", "No vector returned in response body");
      } else if (testVector.length !== EXPECTED_DIMENSIONS) {
        fail("Dimension Match", `Expected ${EXPECTED_DIMENSIONS}, got ${testVector.length}`);
      } else {
        pass(`API online. Vector dimension: ${testVector.length} (matches expected ${EXPECTED_DIMENSIONS})`);
      }
    }
  } catch (e) {
    fail("Embedding API", e.message);
  }

  // ── Test 3: RPC match_documents ──
  console.log("\n3. RPC match_documents...");
  if (testVector) {
    const { data: matched, error: rpcErr } = await supabase.rpc('match_documents', {
      query_embedding: testVector,
      match_threshold: 0.0, // low threshold to ensure we get results for health check
      match_count: 3,
      filter_tenant_id: 'tenant-a',
    });

    if (rpcErr) {
      fail("RPC Call", rpcErr.message);
    } else {
      pass(`RPC OK. Returned ${matched?.length ?? 0} matches for tenant-a`);
    }
  } else {
    fail("RPC Call", "Skipped (no test vector available from step 2)");
  }

  // ── Test 4: Tenant Isolation (RLS via Anon Key) ──
  console.log("\n4. Tenant Isolation (RLS via Anon Key)...");
  if (testVector) {
    // Use the ANON client — this is what the production route.ts uses.
    // The anon key is subject to RLS, so a non-existent tenant should return 0 rows.
    const { data: isolationTest, error: isoErr } = await supabaseAnon.rpc('match_documents', {
      query_embedding: testVector,
      match_threshold: 0.0,
      match_count: 100,
      filter_tenant_id: 'tenant-NONEXISTENT-12345',
    });

    if (isoErr) {
      fail("RLS Isolation", isoErr.message);
    } else if (isolationTest && isolationTest.length > 0) {
      fail("RLS Isolation", `Non-existent tenant returned ${isolationTest.length} rows — DATA LEAK!`);
    } else {
      pass("Non-existent tenant correctly returned 0 rows (RLS enforced)");
    }
  } else {
    fail("RLS Isolation", "Skipped (no test vector available from step 2)");
  }

  // ── Summary ──
  console.log("\n══════════════════════════════════════");
  if (failures === 0) {
    console.log("🎉 ALL CHECKS PASSED. System is healthy.");
    process.exit(0);
  } else {
    console.error(`💀 ${failures} CHECK(S) FAILED. Review output above.`);
    process.exit(1);
  }
}

diagnose().catch(e => {
  console.error("Fatal diagnostic error:", e);
  process.exit(1);
});
