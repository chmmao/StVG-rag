"use client";

import { useState } from 'react';

export default function ChatPage() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string, sources?: any[] }[]>([]);
  const [input, setInput] = useState('');
  const [tenant, setTenant] = useState('tenant-stvg');
  const [llmProvider, setLlmProvider] = useState('openrouter/elephant-alpha');
  const [isLoading, setIsLoading] = useState(false);

  const renderMessageContent = (text: string) => {
    const parts = text.split(/!\[.*?\]\((.*?)\)/g);
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return (
          <div key={index} className="my-4 p-2 bg-gray-100/10 border border-gray-700/50 rounded-lg inline-block shadow-md">
             <img src={part} alt="Verkehrsschild" className="h-28 w-auto object-contain bg-gray-200 rounded" />
          </div>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, tenant_id: tenant, llm_provider: llmProvider, history: messages }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      setMessages(prev => [...prev, { role: 'assistant', content: data.content, sources: data.sources }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-gray-100 font-sans">
      <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-950/50 backdrop-blur-md sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">RAG Prototype</h1>
          <p className="text-xs text-gray-500">Next.js + Supabase + Gemini</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-400 font-medium">Workspace</label>
          <select
            className="bg-gray-800 border border-gray-700 text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
          >
            <option value="tenant-stvg">tenant-stvg (Deutsches Verkehrsrecht StVO/StVG)</option>
            <option value="tenant-a">tenant-a (Galaxies)</option>
            <option value="tenant-b">tenant-b (Empty)</option>
          </select>
          <div className="flex items-center gap-2 border-l border-gray-800 pl-3">
            <label className="text-sm text-gray-400 font-medium">LLM</label>
            <select
              className="bg-gray-800 border border-gray-700 text-sm rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-amber-500 outline-none transition-all text-amber-300 font-medium"
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
            >
              <option value="openrouter/auto">🚀 Auto-Router (Default)</option>
              <option value="openrouter/elephant-alpha">Elephant Alpha (Free High-Context)</option>
              <option value="google/gemma-4-31b-it:free">Gemma 4 31B-IT (Free)</option>
              <option value="nvidia/nemotron-3-super-120b-a12b:free">Nemotron-3 Super 120B (Free)</option>
              <option value="openai/gpt-oss-120b:free">GPT-OSS 120B (Free High-Perf)</option>
              <option value="openai/gpt-oss-20b:free">GPT-OSS 20B (Free Lightweight)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-6 flex flex-col gap-6 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 h-full">
            <svg className="w-16 h-16 mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            <p className="text-lg font-medium">Ask something about the knowledge base.</p>
            <p className="text-sm mt-1">Make sure you are in the correct Workspace.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'bg-gray-800/80 border border-gray-700/50 text-gray-200'}`}>
                <div className="prose prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                  {renderMessageContent(msg.content)}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-700/50 flex flex-col gap-3">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Gefundene juristische Referenzen (StVO/StVG):</span>
                    <div className="flex flex-wrap gap-2 items-start">
                      {msg.sources.map((src, idx) => (
                        <div key={idx} className="flex flex-col gap-2 bg-gray-900 border border-gray-700 rounded-lg p-2 max-w-xs transition hover:border-gray-500">
                          <span className="text-xs text-gray-400 font-medium">
                          {src.source} {src.section ? `› ${src.section}` : ''}
                        </span>
                      </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800/80 border border-gray-700/50 rounded-2xl px-5 py-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '-0.3s' }}></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '-0.15s' }}></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
            </div>
          </div>
        )}
      </main>

      <div className="p-4 bg-gray-950/80 border-t border-gray-800 backdrop-blur-md">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative flex items-center">
          <input
            type="text"
            className="w-full bg-gray-900 border border-gray-700 rounded-full pl-6 pr-14 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm shadow-inner"
            placeholder="Type your question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-full transition-colors flex items-center justify-center shadow-md w-10 h-10"
          >
            <svg className="w-4 h-4 translate-x-px" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}
