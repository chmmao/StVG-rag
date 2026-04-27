# ⚖️ RAG Prototype — German Traffic Law (StVO/StVG)

🌍 **[Deutsche Version unten](#-deutsche-version)**

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)

A retrieval-augmented generation (RAG) MVP built with Next.js, Supabase (pgvector), and free-tier LLM APIs. Answers questions about German traffic regulations by retrieving relevant legal text and generating responses with inline traffic sign images.

## What it does

- Accepts natural-language questions about German traffic law (StVO/StVG)
- Embeds the query with `gemini-embedding-001` (3072-dimensional vectors)
- Retrieves the most relevant legal paragraphs via cosine similarity in pgvector
- Sends retrieved context to an LLM through OpenRouter and returns an answer
- Renders traffic sign images inline when the LLM references them — using **regex-based marker replacement** instead of an expensive Vision API

*A second tenant (`tenant-a`) demonstrates the same pipeline on a small astronomy dataset.*

---

## Project structure

```text
rag-prototype/
├── public/                  # Static traffic sign images and icons
├── scripts/                 # Offline ETL pipeline (Node.js ESM)
│   ├── ingest_universal.mjs # Chunks, embeds, and inserts documents into Supabase
│   ├── diagnose.mjs         # Health check: DB, embedding API, RPC, RLS (npm run health)
│   ├── purge_stvo.mjs       # Deletes all documents from a given source
│   └── test_api.mjs         # Quick Gemini API connectivity test
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts # POST /api/chat — RAG core logic
│   │   ├── favicon.ico       # Browser tab icon
│   │   ├── globals.css       # Global styles (Tailwind & resets)
│   │   ├── layout.tsx        # App entry & SEO Metadata
│   │   └── page.tsx          # Chat UI & Multimodal Image Parser
│   └── lib/
│       └── ai-client.ts      # Shared logic with exponential backoff
├── eslint.config.mjs        # Code quality & Linting configurations
├── next.config.ts           # Framework-specific build settings
├── package.json             # Dependencies & npm scripts
├── package-lock.json        # Deterministic dependency lockfile
├── postcss.config.mjs       # Tailwind CSS processing config
└── tsconfig.json            # TypeScript compiler options
```

---

## Request flow

1. **Client** sends `{ message, tenant_id, llm_provider, history }` to `POST /api/chat`
2. **Server** concatenates recent user messages from `history` for coreference resolution, then embeds the combined text via Gemini
3. **Server** calls the `match_documents` RPC in Supabase, which runs a cosine similarity search (`<=>`) filtered by tenant
4. If no results pass the similarity threshold (0.65), the server returns a fallback message immediately
5. **Server** assembles a system prompt with the retrieved context and sends it to OpenRouter
6. **OpenRouter** returns a text response; the server extracts it and passes it to the client with source metadata
7. **Client** renders the response. If the text contains `![...](url)` markdown, it renders an `<img>` tag pointing to the local traffic sign asset

### Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as Presentation Layer (React)
    participant NextRoute as Logic Layer (Next.js API)
    participant EmbedAPI as Google Embedding (Gemini API)
    participant Supabase as Persistence Layer (pgvector)
    participant OpenRouter as LLM API Gateway

    Note over User, Frontend: Phase 1: Context State Management
    User->>Frontend: Submits Query with dropdown Tenant selection
    Frontend->>Frontend: Extracts history parameters from React State
    Frontend->>NextRoute: POST /api/chat { tenant_id, message, history, llm_provider }
    
    Note over NextRoute, Supabase: Phase 2: Vectorization & Retrieval
    NextRoute->>NextRoute: Concatenates History + Query string
    NextRoute->>EmbedAPI: POST embed text to `gemini-embedding-001`
    EmbedAPI-->>NextRoute: Returns Vector Array[3072]
    NextRoute->>Supabase: RPC: match_documents(vector, threshold, tenant_id)
    Supabase-->>NextRoute: Returns Top-K relevant text nodes

    Note over NextRoute, OpenRouter: Phase 3: Generative Proxy Invocation
    NextRoute->>NextRoute: Assembles System Prompt mapping [BILD] to Markdown
    NextRoute->>OpenRouter: POST chat/completions to selected LLM Endpoint
    OpenRouter-->>NextRoute: Starts Streaming Markdown payload
    
    Note over Frontend, User: Phase 4: Payload Parsing & Native Render
    NextRoute-->>Frontend: ReadableStream JSON
    Frontend->>Frontend: Regex Parser triggers on ![alt](url) matches
    Frontend->>Frontend: Yields native HTML <img /> insertion into DOM
    Frontend-->>User: Visual layout complete
```

---

## Ingestion pipeline

`scripts/ingest_universal.mjs` processes source files offline:

- **XML (StVO/StVG):** Parses `<norm>` elements with cheerio. Replaces `<IMG>` tags with text markers like `[VERKEHRSSCHILD_BILD: filename.jpg]`, then chunks at paragraph boundaries (1000 chars with 200-char overlap)
- **Markdown/Text:** Splits on paragraph breaks, then chunks with the same size/overlap parameters
- **Embedding:** Sends chunks in batches of 50 to Gemini's `batchEmbedContents` endpoint
- **Deduplication:** SHA-256 content hashing prevents re-inserting chunks that already exist in the database
- **Retry:** Exponential backoff on HTTP 429 responses

```bash
# Dry-run to see chunking output without hitting any APIs
node scripts/ingest_universal.mjs public/data/stvg.xml tenant-stvg --dry-run
```

---

## Multi-tenancy & Security

Rows in the `documents` table are tagged with `metadata.tenant_id`. The `match_documents` RPC applies PostgreSQL `SECURITY INVOKER` logic, setting a transaction-scoped session variable (`app.current_tenant`). A strict **Row Level Security (RLS)** policy filters rows at the database level. The Edge API route also validates `tenant_id` against a hardcoded whitelist to prevent IDOR attacks.

**Caveat:** The tenant is chosen by the client in the request body. This is fine for an open-data prototype, but a production system should resolve the tenant server-side via cryptographic session tokens (JWT).

---

## Known limitations

- **No streaming:** The LLM response is returned in full, not streamed token-by-token
- **Embedding model lock-in:** The database stores 3072-dimensional vectors from `gemini-embedding-001`. Switching models requires full DB re-ingestion
- **Single-stage retrieval:** Top-K results use raw cosine similarity. A cross-encoder reranker would improve precision on large corporate datasets

---

## Setup & Deployment

### Prerequisites
- Node.js 18+
- A Supabase project with pgvector enabled
- Google Gemini API key & OpenRouter API key

### 1. Database Configuration
Run the following SQL in the Supabase SQL editor:
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content text NOT NULL,
    metadata jsonb,
    embedding vector
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.documents FOR SELECT TO anon
USING (metadata->>'tenant_id' = current_setting('app.current_tenant', true));

CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector, match_threshold float, match_count int, filter_tenant_id text
) RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM set_config('app.current_tenant', filter_tenant_id, true);
  RETURN QUERY
  SELECT d.id, d.content, d.metadata, 1 - (d.embedding <=> query_embedding) as similarity
  FROM public.documents d
  WHERE 1 - (d.embedding <=> query_embedding) >= match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### 2. Environment Variables
```bash
git clone <repository-url>
cd rag-prototype
npm install
```
Create `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-...
```

### 3. Run the System
```bash
node scripts/ingest_universal.mjs public/data/stvg.xml tenant-stvg
npm run dev        # → Starts UI on http://localhost:3000
npm run health     # CI-ready Check: verify DB, embedding API, RPC, and RLS
```

---
<br>

# 🇩🇪 Deutsche Version

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)

Ein Retrieval-Augmented Generation (RAG) MVP, entwickelt mit Next.js, Supabase (pgvector) und LLM-APIs. Das System beantwortet Fragen zur deutschen Straßenverkehrsordnung (StVO/StVG), indem es relevante Gesetzestexte abruft und Antworten mit direkt eingebetteten Verkehrszeichen generiert.

## Kernfunktionen

- Beantwortet natürlichsprachliche Fragen zum deutschen Verkehrsrecht.
- Vektorisiert Suchanfragen mit `gemini-embedding-001` (3072 Dimensionen).
- Nutzt die Kosinus-Ähnlichkeitssuche in pgvector für präzisen Textabruf.
- **0-Kosten Multimodalität**: Ersetzt teure Vision-APIs durch eine Regex-basierte Logik, die Verkehrszeichen im Textfluss in Echtzeit als lokale Bilder rendert.

## Projektstruktur

```text
rag-prototype/
├── public/                  # Statische Assets (Verkehrszeichen & Icons)
├── scripts/                 # Offline ETL-Pipeline (Node.js/ESM)
│   ├── ingest_universal.mjs # Unified Ingestion: Idempotenter Parser
│   ├── diagnose.mjs         # Automatisierter Health-Check (CI-Ready)
│   ├── purge_stvo.mjs       # Datenbereinigung: Tenant-Löschung
│   └── test_api.mjs         # API-Konnektivitätstest
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts # Edge API: Kernlogik & LLM-Orchestrierung
│   │   ├── favicon.ico       # Browser-Tab-Icon
│   │   ├── globals.css       # Globale Styles (Tailwind & Resets)
│   │   ├── layout.tsx        # App-Struktur & SEO-Metadaten
│   │   └── page.tsx          # UI & Regex-Bild-Parser
│   └── lib/
│       └── ai-client.ts      # Gemeinsame AI-Logik (Backoff-Retry)
├── eslint.config.mjs        # Code-Qualität & Linting
├── next.config.ts           # Next.js Framework-Konfiguration
├── package.json             # Abhängigkeiten & Skripte
├── package-lock.json        # Abhängigkeit-Sperrdatei
├── postcss.config.mjs       # CSS-Verarbeitung (Tailwind)
└── tsconfig.json            # TypeScript-Konfiguration
```

## Request Flow (Ablauf)
*(Ein detailliertes UML-Sequenzdiagramm befindet sich im englischen Teil).*

1. **Client** sendet die Anfrage inklusive Mandanten-ID (`tenant_id`) an die API.
2. **Server** ergänzt den Chat-Verlauf für Kontext-Auflösungen und vektoriert den Text.
3. **Datenbank** führt eine via Row Level Security geschützte Ähnlichkeitssuche aus.
4. **Server** baut den Prompt aus dem gefundenen rechtlichen Kontext zusammen und triggert das ausgewählte LLM (über OpenRouter).
5. **Client** empfängt den formatierten Text. Tritt im Markdown ein Bild-Marker (`![...](url)`) auf, wird das korrekte Verkehrszeichen-Asset geladen.

## Ingestion Pipeline (Datenaufbereitung)
Das Skript `scripts/ingest_universal.mjs` verarbeitet Quelldateien asynchron:
- Parst XML `<norm>`-Elemente und wandelt `<IMG>`-Tags in Textmarker um.
- Zerschneidet Texte an Paragraphengrenzen (1000 Zeichen / 200 Zeichen Überlappung).
- Vermeidet Daten-Duplikate idempotent via **SHA-256 Hashing**.
- Federt API-Rate-Limits mit **Exponential Backoff** ab.

## Sicherheit & Mandantenfähigkeit (Multi-tenancy)
Die Datenbank ist durch **PostgreSQL Row Level Security (RLS)** strikt getrennt. Die `match_documents` RPC-Funktion wendet `SECURITY INVOKER` an und injiziert die Mandanten-ID sicher in die laufende Datenbanktransaktion. Auf API-Ebene greift zudem ein Hardcoded-Whitelist-Schutz.

*(Das SQL-Setup-Skript zur Installation finden Sie im englischen Anleitungsteil).*
