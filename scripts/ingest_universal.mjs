import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

// Dynamically load the .env.local file
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// -- 1. Configuration & God-Mode Keys --
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service Role Key (God-Mode)
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// -- 2. Utility Functions --
const delay = ms => new Promise(res => setTimeout(res, ms));

// Engineering Resilience: Exponential Backoff for API calls
async function fetchWithBackoff(fetchFn, maxRetries = 5, baseDelay = 3000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const response = await fetchFn();
      if (!response.ok) {
        if (response.status === 429) throw new Error("429 Too Many Requests");
        throw new Error(await response.text());
      }
      return await response.json();
    } catch (e) {
      attempt++;
      console.warn(`[API] Attempt ${attempt} failed: ${e.message}`);
      if (attempt >= maxRetries) {
        console.error(`[API] Max retries reached.`);
        throw e;
      }
      const backoffTime = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`[API] Retrying in ${Math.round(backoffTime)}ms...`);
      await delay(backoffTime);
    }
  }
}

async function getBatchEmbeddings(texts) {
  const data = await fetchWithBackoff(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(text => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] }
      }))
    })
  }));
  return data.embeddings.map(e => e.values);
}

function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

// -- 3. Parsing Strategies --

// Strategy A: StVG / StVO XML Semantic Parser (Handles <norm> and [VERKEHRSSCHILD_BILD])
async function parseStvgXml(xmlData, tenantId, sourceFileName) {
  const $ = cheerio.load(xmlData, { xmlMode: true, decodeEntities: false });
  const norms = $('norm').toArray();
  const chunks = [];

  for (let idx = 0; idx < norms.length; idx++) {
    const norm = $(norms[idx]);
    const section = norm.find('enbez').first().text() || `Abschnitt-${idx}`;
    const title = norm.find('titel').first().text() || '';
    
    const contentNode = norm.find('Content');
    if (!contentNode.length) continue;

    let combinedText = `[${section} - ${title}]\n`;
    
    // Multimodal Image Injection
    const imgs = contentNode.find('IMG').toArray();
    if (imgs.length > 0) {
      imgs.forEach(img => {
        const src = $(img).attr('SRC');
        if (src && src.toLowerCase().endsWith('.jpg')) {
          $(img).replaceWith(` [VERKEHRSSCHILD_BILD: ${src}] `);
        }
      });
      combinedText += `\n[Hinweis: Die Verkehrsschilder sind im Text als [VERKEHRSSCHILD_BILD: dateiname.jpg] markiert.]\n`;
    }

    combinedText += contentNode.text().replace(/\s+/g, ' ').trim();
    if (combinedText.length < 50) continue;

    const textChunks = chunkText(combinedText, 1000, 200);
    for (let c = 0; c < textChunks.length; c++) {
      chunks.push({
        text: textChunks[c],
        metadata: { tenant_id: tenantId, source: sourceFileName, section: section, chunk_index: c }
      });
    }
  }
  return chunks;
}

// Strategy B: Generic Document Parser (.md, .txt)
async function parseGenericDocument(rawText, tenantId, sourceFileName) {
  const chunks = [];
  // Basic logical split by double newline
  const paragraphs = rawText.split('\n\n').map(p => p.trim()).filter(p => p.length > 50);
  
  for (let i = 0; i < paragraphs.length; i++) {
    // If a paragraph is exceptionally long, chunk it further mathematically
    const subChunks = chunkText(paragraphs[i], 1000, 200);
    for (let j = 0; j < subChunks.length; j++) {
      chunks.push({
        text: subChunks[j],
        metadata: { tenant_id: tenantId, source: sourceFileName, paragraph_index: i, chunk_index: j }
      });
    }
  }
  return chunks;
}

// -- 4. Main Ingestion Pipeline --
async function ingest() {
  const filePath = process.argv[2];
  const tenantId = process.argv[3] || 'tenant-general';
  const isDryRun = process.argv.includes('--dry-run');

  if (!filePath) {
    console.error("Usage: node scripts/ingest_universal.mjs <file> <tenant_id> [--dry-run]");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  const sourceFileName = path.basename(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();

  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf8');
  let allChunks = [];

  console.log(`[PIPELINE] Booting universal extraction for: ${sourceFileName} (${ext})`);

  // --- Dynamic File Routing ---
  if (ext === '.xml') {
    if (tenantId === 'tenant-stvg') {
      console.log("[ROUTER] Activated Strategy A: German Law Semantic Parser (StVO/StVG).");
      allChunks = await parseStvgXml(fileContent, tenantId, sourceFileName);
    } else {
      console.log("[ROUTER] Activated Generic XML fallback parser. Stripping XML tags...");
      // Strip XML tags and pass to generic string chunker
      const cleanedText = fileContent.replace(/<[^>]+>/g, ' ');
      allChunks = await parseGenericDocument(cleanedText, tenantId, sourceFileName);
    }
  } else if (ext === '.md' || ext === '.txt') {
    console.log("[ROUTER] Activated Strategy B: Generic Markdown/Text Parser.");
    allChunks = await parseGenericDocument(fileContent, tenantId, sourceFileName);
  } else if (ext === '.epub') {
    console.log("[ROUTER] WARNING: EPUB parsing requires third-party binary extraction. Using raw string fallback for MVP...");
    allChunks = await parseGenericDocument(fileContent, tenantId, sourceFileName);
  } else {
    console.error(`[ROUTER ERROR] Unsupported file extension: ${ext}`);
    process.exit(1);
  }

  // --- The Dry-Run Safety Valve ---
  if (isDryRun) {
    console.log("\n=================================");
    console.log("       DRY-RUN RESULTS           ");
    console.log("=================================");
    console.log(`Total Chunks Generated: ${allChunks.length}`);
    if (allChunks.length > 0) {
      console.log("\n--- Sample [Chunk 0] ---");
      console.log(`Metadata: ${JSON.stringify(allChunks[0].metadata)}`);
      console.log("Text snippet:");
      console.log(allChunks[0].text.substring(0, 400) + "...\n");
      
      if (allChunks.length > 1) {
          console.log(`--- Sample [Chunk ${Math.floor(allChunks.length/2)}] ---`);
          console.log(`Metadata: ${JSON.stringify(allChunks[Math.floor(allChunks.length/2)].metadata)}`);
      }
    }
    console.log("=================================");
    console.log("DRY-RUN COMPLETE. Executed 0 Google API calls. Exiting.\n");
    process.exit(0);
  }

  console.log(`\nPrepared ${allChunks.length} chunks. Commencing High-Speed Batch Embedding...`);

  // --- Embed & Load (Offline Batch Process) ---
  const batchSize = 50;
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    console.log(`Processing Batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(allChunks.length / batchSize)} (${batch.length} chunks)...`);
    
    try {
      const embeddings = await getBatchEmbeddings(batch.map(b => b.text));
      
      const insertData = batch.map((b, idx) => ({
        content: b.text,
        embedding: embeddings[idx],
        metadata: b.metadata
      }));

      const { error } = await supabase.from('documents').insert(insertData);
      if (error) throw new Error(error.message);
      
      await delay(1500); // Respect Google Token bucket between mega-batches
    } catch (e) {
      console.error(`[DB ERROR] Batch insertion failed:`, e.message);
    }
  }

  console.log("Successfully completed Universal Ingestion (Batch Mode).");
}

ingest();
