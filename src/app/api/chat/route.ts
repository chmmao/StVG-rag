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
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const pushEvent = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      };

      try {
        const { message, tenant_id = 'tenant-a', llm_provider = 'openrouter/auto', history = [] } = await request.json();

        if (!message) throw new Error("Message is required");
        if (!VALID_TENANTS.has(tenant_id)) throw new Error(`Invalid workspace: "${tenant_id}"`);

        // Phase 1: Vectorization
        pushEvent({ status: "Vectorizing query..." });
        let contextualizedQuery = message;
        if (history && history.length > 0) {
          const pastUserMessages = history.filter((m: any) => m.role === 'user').slice(-2);
          if (pastUserMessages.length > 0) {
            contextualizedQuery = pastUserMessages.map((m: any) => m.content).join(" | ") + " | " + message;
          }
        }
        
        const queryEmbedding = await embedWithRetry(contextualizedQuery, GEMINI_API_KEY);

        // Phase 2: Vector Search
        pushEvent({ status: "Searching database..." });
        const { data: matchedDocuments, error } = await supabase.rpc('match_documents', {
          query_embedding: queryEmbedding,
          match_threshold: 0.65,
          match_count: 5,
          filter_tenant_id: tenant_id,
        });

        if (error) throw new Error("Vector search failed: " + JSON.stringify(error));

        if (!matchedDocuments || matchedDocuments.length === 0) {
          const fallbackMsg = tenant_id === 'tenant-stvg'
            ? "Ich habe zu diesem Thema in den vorliegenden Gesetzestexten (StVO/StVG) keine ausreichenden Informationen gefunden."
            : "I don't have enough context in this workspace to answer that.";
          pushEvent({ text: fallbackMsg, sources: [] });
          controller.close();
          return;
        }

        // Phase 3: Assembly & Generation
        const contextText = matchedDocuments.map((doc: any) => doc.content).join('\n\n---\n\n');
        const systemInstruction = tenant_id === 'tenant-stvg'
          ? `Du bist ein hilfreicher Assistent für deutsche Verkehrsregeln. Beantworte die Frage des Benutzers streng auf der Grundlage des folgenden Kontexts. Halte deine Antwort prägnant und professionell.\n\nWICHTIG: Wenn du im Kontext einen Hinweis wie [VERKEHRSSCHILD_BILD: dateiname.jpg] siehst, und dieser für deine Antwort relevant ist, binde dieses Bild unbedingt genau so als Markdown in deine Antwort ein: ![Verkehrsschild](/data/stvo/dateiname.jpg) \n\nKONTEXT:\n"""\n${contextText}\n"""`
          : `You are a helpful knowledge base assistant. Answer the user's question based strictly on the following context. Keep your answer concise.\n\nCONTEXT:\n"""\n${contextText}\n"""`;

        const sourcesData = matchedDocuments.map((doc: any) => ({
          source: doc.metadata?.source || 'Unknown',
          section: doc.metadata?.section || '',
          image_url: doc.metadata?.image_url || null
        }));

        pushEvent({ status: "Generating answer..." });

        if (llm_provider === 'gemini-1.5-flash-direct') {
            const geminiMessages = history.map((m: any) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }));
            geminiMessages.push({ role: "user", parts: [{ text: message }] });

            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemInstruction }] },
                    contents: geminiMessages
                })
            });

            if (!geminiRes.ok) throw new Error(`Gemini Direct failed: ${geminiRes.status}`);
            const geminiData = await geminiRes.json();
            pushEvent({ text: geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "" });
            
        } else {
            const messages = [{ role: "system", content: systemInstruction }];
            history.forEach((m: any) => messages.push({ role: m.role, content: m.content }));
            messages.push({ role: "user", content: message });

            const isDeepSeek = llm_provider === 'deepseek-v4-flash';
            const apiUrl = isDeepSeek ? "https://api.deepseek.com/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
            const apiKey = isDeepSeek ? DEEPSEEK_API_KEY : (process.env.OPENROUTER_API_KEY || "");
            const modelName = isDeepSeek ? "deepseek-chat" : llm_provider;

            const res = await fetch(apiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: modelName, messages: messages, stream: true })
            });

            if (!res.ok) throw new Error(`LLM API failed: ${res.status}`);

            const reader = res.body!.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep the last incomplete line
                    
                    for (const line of lines) {
                        if (line.trim().startsWith('data: ') && !line.includes('[DONE]')) {
                            try {
                                const data = JSON.parse(line.trim().slice(6));
                                const content = data.choices?.[0]?.delta?.content;
                                if (content) {
                                    pushEvent({ text: content });
                                }
                            } catch (e) {
                                // Ignore parse errors on partial chunks
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        }

        // Finalize: send sources
        pushEvent({ sources: sourcesData });

      } catch (err: any) {
        console.error("API Stream Error:", err);
        pushEvent({ error: err.message || "An unexpected error occurred." });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
    }
  });
}
