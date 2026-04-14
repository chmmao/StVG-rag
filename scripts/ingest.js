import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Dynamically import the Google GenAI SDK (since it's ESM/CJS compatible but we want to be safe)
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function ingest() {
  const filePath = process.argv[2];
  const tenantId = process.argv[3] || 'tenant-a'; // Provide default tenant

  if (!filePath) {
    console.error("Usage: node scripts/ingest.js <file-path> [tenant_id]");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  console.log(`Loaded file with ${content.length} characters.`);

  // Basic chunking: split by logical paragraphs (e.g. double newline)
  const chunks = content.split('\n\n').map(p => p.trim()).filter(p => p.length > 50);
  console.log(`Split into ${chunks.length} chunks (ignoring very short ones).`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[${i+1}/${chunks.length}] Processing chunk for tenant: ${tenantId}...`);

    try {
      // 1. Get Embedding from Google Gemini
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: chunk,
      });
      
      let embedding;
      if (response.embeddings) {
        embedding = response.embeddings[0].values;
      } else {
        // Fallback for older/different shaping
        embedding = response.embedding.values;
      }

      // 2. Insert into Supabase
      const { error } = await supabase.from('documents').insert({
        content: chunk,
        embedding: embedding,
        metadata: {
          tenant_id: tenantId,
          source: path.basename(filePath)
        }
      });

      if (error) {
        console.error("Supabase insert error:", error);
      } else {
        console.log(` -> Successfully inserted chunk ${i+1}.`);
      }
    } catch (e) {
      console.error(` -> Failed to process chunk ${i+1}:`, e.message);
    }
  }

  console.log("Ingestion complete.");
}

ingest();
