import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedWithRetry } from '@/lib/ai-client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // strict runtime bound to anon for RLS
const supabase = createClient(supabaseUrl, supabaseKey);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

// [Enterprise] Tenant validation whitelist — rejects unknown namespaces at the API boundary
const VALID_TENANTS = new Set(['tenant-stvg', 'tenant-a']);

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
    const queryEmbedding = await embedWithRetry(contextualizedQuery, GEMINI_API_KEY);

    // 2. Perform vector search in Supabase using the RPC function
    const { data: matchedDocuments, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65, // [Phase 4] Enforcing Math Logic limit
      match_count: 5,
      filter_tenant_id: tenant_id,
    });

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
      ? `Du bist ein hilfreicher Assistent für deutsche Verkehrsregeln. Beantworte die Frage des Benutzers streng auf der Grundlage des folgenden Kontexts. Halte deine Antwort prägnant und professionell.\n\nWICHTIG: Wenn du im Kontext einen Hinweis wie [VERKEHRSSCHILD_BILD: dateiname.jpg] siehst, und dieser für deine Antwort relevant ist, binde dieses Bild unbedingt genau so als Markdown in deine Antwort ein: ![Verkehrsschild](/data/stvo/dateiname.jpg) \n\nKONTEXT:\n${contextText}`
      : `You are a helpful knowledge base assistant. Answer the user's question based strictly on the following context. Keep your answer concise.\n\nCONTEXT:\n${contextText}`;

    // 4. Generate Answer using Universal OpenRouter API
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
    
    const messages: any[] = [
      { role: "system", content: systemInstruction }
    ];

    // Formulate LLM Conversational Memory
    if (history && history.length > 0) {
      history.forEach((m: any) => {
        messages.push({ role: m.role, content: m.content });
      });
    }
    
    // Append current query
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
              content: "⚠️ **Quota Exceeded / Limit Reached.**\n\nDas ausgewählte Sprachmodell (LLM) hat sein Limit erreicht. Die Datenbank hat die gesuchten Paragraphen erfolgreich gefunden, aber das KI-Modell verweigert die Generierung der Antwort.\n\n👉 **Bitte wechsle oben im Dropdown-Menü zu einem anderen Modell (z.B. DeepSeek oder OpenAI), um fortzufahren!**",
              sources: [] 
           });
        }
        if (genRes.status === 401) {
           return NextResponse.json({ 
              role: 'assistant', 
              content: "⚠️ **Invalid API Key.**\n\nPlease check your OPENROUTER_API_KEY in `.env.local`.",
              sources: []
           });
        }
        throw new Error(`OpenRouter API failed: ${genRes.status} - ${await genRes.text()}`);
    }
    
    const genData = await genRes.json();
    const responseText = genData.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response via OpenRouter.";

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
