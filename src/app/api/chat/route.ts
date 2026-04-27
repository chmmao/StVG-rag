import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedWithRetry } from '@/lib/ai-client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // strict runtime bound to anon for RLS
const supabase = createClient(supabaseUrl, supabaseKey);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";

// [Enterprise] Tenant validation whitelist — rejects unknown namespaces at the API boundary
const VALID_TENANTS = new Set(['tenant-stvg', 'tenant-a', 'tenant-b']);

export async function POST(request: Request) {
  try {
    const { message, tenant_id = 'tenant-a', llm_provider = 'openrouter/auto', history = [] } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // [Enterprise] Reject unknown tenant namespaces before any DB/API interaction
    if (!VALID_TENANTS.has(tenant_id)) {
      return NextResponse.json(
        { error: `Invalid workspace: "${tenant_id}". Valid: ${[...VALID_TENANTS].join(', ')}` },
        { status: 400 }
      );
    }

    // 1(a). Contextualize the vector query using recent conversational memory
    let contextualizedQuery = message;
    if (history && history.length > 0) {
      const pastUserMessages = history.filter((m: any) => m.role === 'user').slice(-2);
      if (pastUserMessages.length > 0) {
        contextualizedQuery = pastUserMessages.map((m: any) => m.content).join(" | ") + " | " + message;
      }
    }

    // 1(b). Generate embedding via shared AI client (with exponential backoff retry)
    console.time("⏱️  Phase 1: Embedding");
    const queryEmbedding = await embedWithRetry(contextualizedQuery, GEMINI_API_KEY);
    console.timeEnd("⏱️  Phase 1: Embedding");

    // 2. Perform vector search in Supabase using the RPC function
    console.time("⏱️  Phase 2: Vector Search");
    const { data: matchedDocuments, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65, // [Phase 4] Enforcing Math Logic limit
      match_count: 5,
      filter_tenant_id: tenant_id,
    });
    console.timeEnd("⏱️  Phase 2: Vector Search");

    if (error) {
      console.error("Supabase vector search error:", error);
      throw new Error("Vector search failed: " + JSON.stringify(error));
    }

    // [Phase 4 Circuit Breaker]: Immediate short-circuit if threshold is not met
    if (!matchedDocuments || matchedDocuments.length === 0) {
      const fallbackMsg = tenant_id === 'tenant-stvg'
        ? "Ich habe zu diesem Thema in den vorliegenden Gesetzestexten (StVO/StVG) keine ausreichenden Informationen gefunden."
        : "I don't have enough context in this workspace to answer that.";
        
      return NextResponse.json({ 
        role: 'assistant', 
        content: fallbackMsg,
        sources: []
      });
    }

    // 3. Prepare the Prompt with Context
    let contextText = '';
    let matchCount = matchedDocuments.length;
    contextText = matchedDocuments.map((doc: any) => doc.content).join('\n\n---\n\n');

    const systemInstruction = tenant_id === 'tenant-stvg'
      ? `Du bist ein hilfreicher Assistent für deutsche Verkehrsregeln. Beantworte die Frage des Benutzers streng auf der Grundlage des folgenden Kontexts. Halte deine Antwort prägnant und professionell.\n\nWICHTIG: Wenn du im Kontext einen Hinweis wie [VERKEHRSSCHILD_BILD: dateiname.jpg] siehst, und dieser für deine Antwort relevant ist, binde dieses Bild unbedingt genau so als Markdown in deine Antwort ein: ![Verkehrsschild](/data/stvo/dateiname.jpg) \n\nKONTEXT:\n"""\n${contextText}\n"""`
      : `You are a helpful knowledge base assistant. Answer the user's question based strictly on the following context. Keep your answer concise.\n\nCONTEXT:\n"""\n${contextText}\n"""`;

    // 4. Generate Answer
    console.time("⏱️  Phase 3: LLM Generation");
    let responseText = "";

    if (llm_provider === 'gemini-1.5-flash-direct') {
        // --- High-Performance Path: Direct Google Gemini API ---
        const geminiMessages = [];
        
        // Map history to Gemini format (user/model roles)
        if (history && history.length > 0) {
            history.forEach((m: any) => {
                geminiMessages.push({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                });
            });
        }
        
        // Append current query
        geminiMessages.push({ role: "user", parts: [{ text: message }] });

        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
            {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY
                },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemInstruction }] },
                    contents: geminiMessages
                })
            }
        );
        console.timeEnd("⏱️  Phase 3: LLM Generation");

        if (!geminiRes.ok) {
            throw new Error(`Google Gemini Direct failed: ${geminiRes.status} - ${await geminiRes.text()}`);
        }

        const geminiData = await geminiRes.json();
        responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response via Google Gemini Direct.";
    } else if (llm_provider === 'deepseek-v4-flash') {
        // --- High-Performance Path: Direct DeepSeek API (Paid) ---
        const messages: any[] = [
            { role: "system", content: systemInstruction }
        ];

        if (history && history.length > 0) {
            history.forEach((m: any) => {
                messages.push({ role: m.role, content: m.content });
            });
        }
        messages.push({ role: "user", content: message });

        const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: messages
            })
        });
        console.timeEnd("⏱️  Phase 3: LLM Generation");

        if (!dsRes.ok) {
            throw new Error(`DeepSeek Direct failed: ${dsRes.status} - ${await dsRes.text()}`);
        }

        const dsData = await dsRes.json();
        responseText = dsData.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response via DeepSeek Direct.";
    } else {
        // --- Default Path: Universal OpenRouter API Gateway ---
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
        const messages: any[] = [
            { role: "system", content: systemInstruction }
        ];

        if (history && history.length > 0) {
            history.forEach((m: any) => {
                messages.push({ role: m.role, content: m.content });
            });
        }
        messages.push({ role: "user", content: message });

        const genRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: llm_provider,
                messages: messages
            })
        });

        if (!genRes.ok) {
            if (genRes.status === 429 || genRes.status === 402) {
                return NextResponse.json({ 
                    role: 'assistant', 
                    content: "⚠️ **Quota Exceeded / Limit Reached.**\n\nDas ausgewählte Sprachmodell (LLM) hat sein Limit erreicht. Bitte wechsle zu einem anderen Modell!",
                    sources: [] 
                });
            }
            throw new Error(`OpenRouter API failed: ${genRes.status} - ${await genRes.text()}`);
        }
        
        const genData = await genRes.json();
        responseText = genData.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response via OpenRouter.";
    }

    // Extract sources & multimodal images for frontend rendering
    const sources = matchedDocuments.map((doc: any) => {
        return {
            source: doc.metadata?.source || 'Unknown',
            section: doc.metadata?.section || '',
            image_url: doc.metadata?.image_url || null
        };
    });

    return NextResponse.json({ 
        role: 'assistant', 
        content: responseText,
        sources: sources
    });

  } catch (error: any) {
    console.error("API error:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}
