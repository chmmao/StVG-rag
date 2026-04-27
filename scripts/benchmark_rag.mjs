import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function benchmark(question) {
    console.log(`\n🚀 Benchmarking Question: "${question}"`);
    console.log(`-------------------------------------------`);

    // --- Phase 1: Embedding ---
    console.time("⏱️  Phase 1: Embedding (Gemini)");
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
                content: { parts: [{ text: question }] },
            }),
        }
    );
    const embedData = await embedRes.json();
    const queryEmbedding = embedData.embedding.values;
    console.timeEnd("⏱️  Phase 1: Embedding (Gemini)");

    // --- Phase 2: Vector Search ---
    console.time("⏱️  Phase 2: Vector Search (Supabase)");
    const { data: matchedDocuments, error } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 3,
        filter_tenant_id: 'tenant-stvg',
    });
    console.timeEnd("⏱️  Phase 2: Vector Search (Supabase)");

    if (error) {
        console.error("DB Error:", error);
        return;
    }

    const contextText = matchedDocuments.map(doc => doc.content).join('\n\n---\n\n');

    // --- Phase 3: Generation ---
    console.time("⏱️  Phase 3: Generation (DeepSeek)");
    const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: "Answer based on context: " + contextText },
                { role: "user", content: question }
            ]
        })
    });
    const dsData = await dsRes.json();
    console.timeEnd("⏱️  Phase 3: Generation (DeepSeek)");

    console.log(`\n✅ Answer derived successfully.`);
    console.log(`   Tokens used: ${dsData.usage?.total_tokens || 'Unknown'}`);
}

benchmark("Wie fast darf man mit einem LKW über 3,5t außerorts fahren?").catch(console.error);
