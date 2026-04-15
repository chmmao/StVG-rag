import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function diagnose() {
  console.log("1. Checking DB row count...");
  const { data: countData, error: countErr } = await supabase.from('documents').select('id, metadata').limit(10);
  if (countErr) {
    console.error("DB Count Error:", countErr);
  } else {
    console.log("Documents in DB:", countData.length);
    console.log("Sample metadata:", countData[0]?.metadata);
  }

  console.log("\n2. Checking test embedding generation...");
  const embedRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: "what is a galaxy" }] }
    })
  });
  
  if (!embedRes.ok) {
     console.error("Embed failed:", await embedRes.text());
     return;
  }
  const embedData = await embedRes.json();
  const vector = embedData.embedding?.values;
  
  if (!vector) {
     console.error("No vector returned:", embedData);
     return;
  }
  console.log("Vector generated, length:", vector.length);

  console.log("\n3. Testing RPC match_documents...");
  const { data: matched, error: rpcErr } = await supabase.rpc('match_documents', {
      query_embedding: vector,
      match_count: 5,
      filter_tenant_id: 'tenant-a',
  });
  
  if (rpcErr) {
    console.error("RPC Error:", rpcErr);
  } else {
    console.log(`RPC matches: ${matched?.length ?? 0}`);
    if (matched?.length > 0) {
      console.log("Top match similarity:", matched[0].similarity);
    }
  }
}

diagnose();
