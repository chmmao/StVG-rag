# ⚖️ Multimodal Legal RAG Prototype (StVO / StVG)

🌍 **[Deutsche Version unten](#-deutsche-version)**

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)

## 🚀 Live Preview & Core Demo

![Live Demo Placeholder: Chat Interface showing a StVO question with a traffic sign image rendered instantly](https://img.shields.io/badge/Status-Production--Ready-brightgreen)
![LLM: Gemini 2.0 / Gemma 2](https://img.shields.io/badge/LLM-Multimodal--Fusion-blue)

> **"What is the speed limit here? [IMAGE]"** -> *The system retrieves StVO § 3, identifies the sign marker, and renders the specific traffic sign .jpg locally from the public asset directory.*

### ⚡ Key Architectural Breakthroughs
- **Zero-Cost Multimodality**: Bypasses expensive Vision LLM APIs using a **Regex-based Interception Layer** to snap-render 250+ traffic signs.
- **Enterprise Multi-Tenancy**: Hardened via **PostgreSQL Row Level Security (RLS)** and dynamic `tenant_id` session variables.
- **Resilient ETL**: Built-in **Exponential Backoff** retry logic to survive API rate-limits during bulk legal ingestion.
- **High-Fidelity Vectors**: Optimized for **3072-dimensional** semantic embeddings (Gemini-001) for precise legal retrieval.

---

## 1. Project Motivation & Problems Addressed

This project is an End-to-End Retrieval-Augmented Generation (RAG) Minimum Viable Product (MVP) aimed at answering complex legal queries based on the German Traffic Law (StVO/StVG). 

**The Challenge:** Traditional RAG systems struggle with multimodal documents (laws heavily reliant on traffic sign images). Passing thousands of images to Vision models for ingestion is financially exorbitant and critically slow. Furthermore, strict separation of legal domains (e.g., Traffic Law vs. Astrophysics) is required.

**The Solution:** This project introduces a decoupled architecture featuring **Regex Interception** for zero-cost localized multimodality, **Context Array Fusion** for conversational continuity, and **Dynamic Model Routing** via OpenRouter allowing prompt-level LLM switching without server redeployment.

---

## 2. Project Structure

```text
rag-prototype/
├── public/                     # Static Assets (Multimodal Images & Icons)
├── scripts/                    # Offline ETL Pipeline (Node.js/ESM)
│   ├── diagnose.mjs            # Automated Health Check (CI-Ready)
│   ├── ingest_universal.mjs    # Unified Ingestion: Idempotent Strategy Parser
│   ├── purge_stvo.mjs          # Data Maintenance: Tenant Truncation
│   └── test_api.mjs            # API Endpoint Connectivity Testing
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts   # Edge API: RAG Retrieval & LLM Orchestration
│   │   ├── globals.css         # UI Design System & Component Styling
│   │   └── page.tsx            # Client View: Regex-driven Image Handler
│   └── lib/
│       └── ai-client.ts        # Shared AI Resilience & Embedding Logic
├── .env.local                  # Environment Configuration (Git-ignored)
├── package.json                # Project Manifest (Now with npm run health)
└── README.md                   # System Architecture Documentation
```

---

## 3. Core Architecture & ETL Pipeline

The system enforces a strict separation of concerns between client rendering, edge API orchestration, and an offline Extract-Transform-Load (ETL) data pipeline.

### Chronological Request Flow (Sequence Diagram)

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

### The Offline ETL Pipeline (Data Engineering Layer)
The ingestion layer operates asynchronously via `scripts/ingest_universal.mjs`, reflecting a production-ready **Extract-Transform-Load (ETL)** pattern:
1. **Extract**: Ingests heterogeneous source files (XML, Markdown, Text) from local or cloud-native storage.
2. **Transform (Semantic Chunking)**: Utilizing `cheerio` for XML DOM mutation. Unlike naive sliding windows, we enforce **Atomic Chunking** by splitting text precisely at legal `<norm>` boundaries.
   - **Image Tokenization**: `<img />` tags are intercepted and converted into semantic text markers: `[VERKEHRSSCHILD_BILD: filename.jpg]`.
3. **Load (Indempotent Loading)**:
   - **Batching**: Processes 50-chunk payloads via Google’s `batchEmbedContents`.
   - **Resilience**: Implements an **Exponential Backoff Engine** to handle Upstream Rate-Limits (HTTP 429).
   - **Data Integrity**: (Roadmap) Hash-based deduplication to ensure ingestion is **Idempotent** (no duplicate laws on re-runs).

---

## 5. 🚀 Data Engineering & ML Scalability Roadmap

For a production deployment at scale (millions of legal documents), the architecture evolves as follows:

### A. Pipeline Orchestration (Apache Airflow)
Current manual execution would be replaced by **Airflow DAGs**:
- **Sensor Task**: Monitors governmental XML feeds for legal updates.
- **Worker Task**: Triggers the Dockerized ingestion script.
- **SLA Management**: Ensures the vector database is updated within 24h of a law change.

### B. Distributed Processing (Apache Spark / Databricks)
To scale horizontally across Public Cloud instances (AWS/GCP):
- **Parallel Embedding**: Use PySpark to distribute embedding requests across a cluster, bypassing the limitations of single-node I/O.
- **Delta Lake**: Store historical law versions for "Time-Travel" legal RAG.

### C. Containerization & CI/CD
- **Docker**: The ETL pipeline is containerized for consistent execution across environments.
- **Terraform/IaC**: Infrastructure for Supabase/PostgreSQL is managed via code.

---

## 6. Key Design Choices & Technical Rationales

To deploy this project locally on your machine, follow these steps:

### Prerequisites
- Node.js (v18+)
- A [Supabase](https://supabase.com/) account
- API Keys for Google Gemini and OpenRouter

### 1. Supabase Database Configuration
Execute the following SQL string in your Supabase SQL Editor to initialize the vector store and the RPC retrieval function:
```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Create table (uuid based, dimension-agnostic for scalability)
CREATE TABLE public.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content text NOT NULL,
    metadata jsonb,
    embedding vector 
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Block unauthorized leakage, strictly tying tenant_id to active queries
CREATE POLICY tenant_isolation ON public.documents FOR SELECT TO anon 
USING (metadata->>'tenant_id' = current_setting('app.current_tenant', true));

-- RPC Function implementing Security Invoker for RLS obedience
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector, match_threshold float, match_count int, filter_tenant_id text
) RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  -- Inject the requested tenant into Postgres transaction context
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

### 2. Local Environment Setup
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd rag-prototype
npm install
```

Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-key
GEMINI_API_KEY=your-google-gemini-key
OPENROUTER_API_KEY=your-openrouter-key
```

### 🗝️ Key Vault Breakdown
- **`NEXT_PUBLIC_SUPABASE_URL`**: The domain address of your database. Not a secret.
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**: The "Guest Pass". Read by the Next.js API to query answers. Completely neutered by Postgres RLS, it cannot accidentally overwrite or destroy laws.
- **`SUPABASE_SERVICE_ROLE_KEY`**: The "God-Mode Pass". Bypasses all security firewalls. Never exposed to Next.js; strictly bound offline to `scripts/ingest_universal.mjs` for raw backend data loading.
- **`GEMINI_API_KEY`**: Senses semantics and builds Mathematical Vectors.
- **`OPENROUTER_API_KEY`**: The conversational linguistic broker.

### 3. Run the System
*(Optional)* If you wish to re-ingest the data pipeline:
```bash
node scripts/ingest_universal.mjs ./data/stvg.xml tenant-stvg
# 💡 Add --dry-run to test chunking & extraction locally without hitting the database or LLM API!
```

Start the Next.js development server:
```bash
npm run dev
```
Navigate to `http://localhost:3000`.

---

## 5. Key Design Choices & Technical Rationale

This MVP reflects deliberate architectural paradigms mapped directly to our Sequence Diagram:

### Phase 1: Context State Management
*   **Why rely on React state for `N-1 History` (Memory Context Fusion)?**
    Forcing conversational memory to operate entirely stateless on the Next.js backend drastically reduces database read/write volume. The UI client passes its history array in the HTTP body, mitigating Grammatical Coreferences (e.g. asking "What does *it* mean?") instantly without relying on rigid server-side JWT session architectures for MVP validation.

### Phase 2: Vectorization & Retrieval
*   **Why utilize `gemini-embedding-001` configured to 3072 dimensions?**
    The 3072-dimension structure provides high-fidelity semantic resolution critical for parsing complex legal language. We selected `gemini-embedding-001` explicitly for its generous free-tier batch-processing limits and superior multilingual (German) performance.
*   **Why execute search logic via an RPC (`match_documents`) instead of pulling DB data into Next.js?**
    Maximum Network Efficiency. Vector matching requires assessing thousands of complex floats. Processing Cosine Distance limits (`<=>`) specifically within the native PostgreSQL extension avoids completely serializing massive vector records over HTTPS, returning only Top-K strings to the Node environment.

### Phase 3: Generative Proxy Invocation
*   **Why proxy generation through `OpenRouter` instead of querying LLMs natively from frontend?**
    Enforces a strict "Blind Generation" paradigm. By shifting request assembly strictly to the backend `route.ts`, the final generative LLM stays completely oblivious to the private structure of the retrieved Postgres chunks or System prompt instructions dictating Marker conversions. The user can switch the underlying foundation model (Gemini, Gemma, etc.) dynamically via the UI without requiring environment variable restarts or backend redeployments.

### Phase 4: Payload Parsing & Native Render
*   **Why intercept Output streams with `Regex` rather than relying on Vision LLM models natively?**
    Feeding hundreds of traffic sign images through a Vision LLM API is financially and computationally exorbitant, provoking heavy processing lag and risk of "hallucinations". By executing offline `[VERKEHRSSCHILD_BILD: xyz]` marker replacement within the XML Extraction process, the LLM treats images merely as text strings to output. Front-end React intercepts this pattern instantly—cutting the text stream and snapping physical image routes functionally local to the server. This yields 100% multimodality overhead-free.

---

## 6. Architectural Limitations & Boundaries

Due to execution constraints necessary for building an MVP, technical debts reside within this architecture model:

1. **Weak Namespace Isolation (Security)**: Retrieval namespace segmentation operates by relying on the client transmitting plaintext boundaries (`tenant_id`). While operationally acceptable for navigating open-source datasets, for production enterprise adoption, target `tenant_id` resolution must operate exclusively relying on validated cryptographic Session Tokens (JWT) passing contexts into backend Postgres RLS policies.
2. **Dimension-Model Coupling**: The database stores 3072-dimensional vectors generated by `gemini-embedding-001`. Switching to a different embedding model with different output dimensions would require full re-ingestion of all data.
3. **Naive Single-Stage Retrieval Fidelity**: Top-K responses rely comprehensively on straightforward nearest-neighbor Cosine Similarity comparisons without filtering. Advanced pipelines mandate standardizing a **Cross-Encoder Reranking** process immediately post-retrieval to evaluate semantic relation structures with high precision, eliminating "Lost in the Middle" LLM inaccuracies.
---

## 7. ✅ Production-Ready Checklist

The following enterprise-grade features have been implemented beyond the core MVP:

| Feature | Status | Implementation |
|---|---|---|
| **Row Level Security (RLS)** | ✅ | `SECURITY INVOKER` + `tenant_id` session isolation in PostgreSQL |
| **Tenant Validation** | ✅ | Hardcoded whitelist in `route.ts` rejects unknown namespaces at the API boundary |
| **Idempotent Ingestion** | ✅ | SHA-256 content hashing in `ingest_universal.mjs` prevents data duplication on re-runs |
| **API Resilience** | ✅ | Exponential backoff retry for Embedding API (shared via `src/lib/ai-client.ts`) |
| **Circuit Breaker** | ✅ | `match_threshold` in `match_documents` RPC prevents hallucination on low-confidence results |
| **Automated Health Check** | ✅ | `npm run health` validates DB connectivity, vector dimensions (3072), RPC, and RLS isolation |
| **Shared AI Client** | ✅ | Centralized embedding logic in `src/lib/ai-client.ts` with cross-referenced ETL copy |

### Quick Verification
```bash
npm run health    # CI-ready: exits 0 on success, 1 on failure
```

---
<br>

# 🇩🇪 Deutsche Version

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)

## 🚀 Live-Vorschau & Core-Demo

![Live Demo Placeholder: Chat Interface zeigt eine StVO-Anfrage mit sofort gerendertem Verkehrszeichen](https://img.shields.io/badge/Status-Production--Ready-brightgreen)
![LLM: Gemini 2.0 / Gemma 2](https://img.shields.io/badge/LLM-Multimodal--Fusion-blue)

> **"Welche Geschwindigkeit gilt hier? [BILD]"** -> *Das System ruft StVO § 3 ab, erkennt den Bild-Marker und rendert das spezifische Verkehrszeichen (.jpg) direkt aus dem lokalen Asset-Verzeichnis.*

### ⚡ Architektonische Meilensteine
- **0-Kosten Multimodalität**: Umgeht teure Vision-LLM-APIs durch eine **Regex-basierte Interception-Layer**, um über 250 Verkehrszeichen blitzschnell zu rendern.
- **Enterprise Multi-Tenancy**: Absicherung durch **PostgreSQL Row Level Security (RLS)** und dynamische `tenant_id` Sitzungsvariablen.
- **Resiliente ETL-Pipeline**: Integrierte **Exponential Backoff** Logik, um API-Rate-Limits während der massenhaften Datenindizierung zu bewältigen.
- **High-Fidelity Vektoren**: Optimiert für **3072-dimensionale** semantische Embeddings (Gemini-001) für präzise juristische Abfragen.

---

## 1. Projektmotivation & Lösungsansatz

Dieses Projekt ist ein Minimum Viable Product (MVP) für ein End-to-End Retrieval-Augmented Generation (RAG) System, das komplexe rechtliche Fragen auf Basis der deutschen Straßenverkehrsordnung (StVO/StVG) beantwortet.

**Die Herausforderung:** Traditionelle RAG-Systeme scheitern oft an multimodalen Dokumenten (Gesetze, die stark von Abbildungen der Verkehrszeichen abhängen). Tausende Bilder über Vision-Modelle zu indexieren, ist finanziell exorbitant teuer und langsam. 

**Die Lösung:** Eine entkoppelte Architektur mit **Regex-Interception** für eine kostenlose Bild-Einbettung, **Context-Fusion** (Gesprächshistorie) für kontextuelle Kontinuität und **Dynamic Model Routing** über OpenRouter.

## 3. Projektstruktur

```text
rag-prototype/
├── public/                     # Statische Assets (Multimodale Bilder & Icons)
├── scripts/                    # Offline ETL-Pipeline (Node.js/ESM)
│   ├── diagnose.mjs            # Automatisierter Health-Check (CI-Ready)
│   ├── ingest_universal.mjs    # Unified Ingestion: Idempotenter Parser
│   ├── purge_stvo.mjs          # Datenbereinigung: Tenant-Löschung
│   └── test_api.mjs            # API-Konnektivitätstest
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts   # Edge API: RAG-Abruf & LLM-Orchestrierung
│   │   ├── globals.css         # UI Design System & Styling
│   │   └── page.tsx            # Client View: Regex-gesteuerter Bild-Parser
│   └── lib/
│       └── ai-client.ts        # Gemeinsame AI-Logik & Embedding-Library
├── .env.local                  # Umgebungsvariablen (Git-ignoriert)
├── package.json                # Projekt-Manifest (Inkl. npm run health)
└── README.md                   # Systemarchitektur-Dokumentation
```

## 4. Kernarchitektur & ETL-Pipeline

*(Hinweis: Das Sequenzdiagramm befindet sich im englischen Teil oben).*

### Die Offline ETL-Pipeline (Data Engineering Layer)
Die Datenaufbereitung operiert völlig unabhängig von der Next.js Serverumgebung über das Skript `scripts/ingest_universal.mjs` und folgt einem produktionsreifen **ETL-Muster**:
1. **Extract**: Liest heterogene Quelldateien (XML, Markdown, Text) aus lokalen oder Cloud-Speichern ein.
2. **Transform (Semantic Chunking)**: Nutzt `cheerio` für XML-Mutationen. Wir erzwingen **Atomic Chunking**, indem wir Texte präzise an Paragraphen-Grenzen (`<norm>`) trennen, statt ungenaue Sliding-Windows zu nutzen.
   - **Bild-Tokenisierung**: `<img>` Tags werden abgefangen und in semantische Text-Marker umgewandelt: `[VERKEHRSSCHILD_BILD: dateiname.jpg]`.
3. **Load (Idempotente Indexierung)**:
   - **Batching**: Verarbeitet Chunks in 50er-Paketen via `batchEmbedContents`.
   - **Resilienz**: Implementiert eine **Exponential Backoff-Engine**, um API-Rate-Limits (HTTP 429) abzufedern.
   - **Datenintegrität**: Hash-basierte Deduplizierung stellt sicher, dass die Indexierung **idempotent** ist (keine Duplikate bei wiederholten Durchläufen).

---

## 5. 🚀 Roadmap: Data Engineering & Skalierbarkeit

Für den produktiven Einsatz im großen Stil (Millionen von Dokumenten) sieht die Architektur folgende Evolutionsstufen vor:

### A. Pipeline-Orchestrierung (Apache Airflow)
Die manuelle Ausführung wird durch **Airflow DAGs** ersetzt:
- **Sensor Task**: Überwacht Regierungs-Feeds auf Gesetzesänderungen.
- **Worker Task**: Triggert das dockerisierte Ingestion-Skript.
- **SLA Management**: Garantiert Updates der Vektordatenbank innerhalb von 24 Stunden.

### B. Verteilte Verarbeitung (Apache Spark / Databricks)
Horizontale Skalierung in der Cloud (AWS/GCP):
- **Paralleles Embedding**: Nutzung von PySpark, um Embedding-Anfragen über einen Cluster zu verteilen.
- **Delta Lake**: Speicherung historischer Gesetzesstände für "Time-Travel" RAG-Abfragen.

### C. Containerisierung & CI/CD
- **Docker**: Die ETL-Pipeline wird für konsistente Ausführung containerisiert.
- **Terraform/IaC**: Die Infrastruktur für Supabase/PostgreSQL wird als Code verwaltet.

---

## 6. Kern-Designentscheidungen (Phasenbasiert)

### 1. Supabase Datenbank-Setup
Führe das folgende SQL-Skript im Supabase Query Editor aus, um die Vektordatenbank und die RPC-Funktion zu initialisieren:
*(Das SQL-Skript befindet sich im englischen Teil).*

### 2. Lokales Setup
Repository klonen und Node-Pakete installieren:
```bash
git clone <repository-url>
cd rag-prototype
npm install
```

Eine `.env.local` Datei im Hauptverzeichnis mit folgenden Schlüsseln anlegen:
```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

### 3. System starten (Dev Server)
```bash
npm run dev
```
*(Die Applikation läuft jetzt auf http://localhost:3000).*

## 6. Kern-Designentscheidungen (Phasenbasiert)

Dieses MVP demonstriert kritische Technologie-Entscheidungen, referenziert auf das obige Sequenzdiagramm:

### Phase 1: Context State Management
*   **Warum basiert die `N-1 History` (Koreferenzauflösung) auf dem React State?**
    Die Verlagerung der Gesprächshistorie in den clientseitigen Payload löst Koreferenzfragen (z.B. Folgefragen wie "Und was ist damit gemeint?") augenblicklich auf. Es macht ein zustandsbehaftetes Serverprotokoll oder Session-Datenbanken für dieses zeitlich eingeschränkte MVP obsolet.

### Phase 2: Vectorization & Retrieval
*   **Warum die Nutzung von `gemini-embedding-001` mit 3072 Dimensionen?**
    3072 Dimensionen bieten eine hochauflösende semantische Erfassung, die für die Analyse komplexer Rechtssprache entscheidend ist. Die Auswahl dieses Modells erfolgte aufgrund des großzügigen Free-Tier-Volumens für Massenverarbeitungen und der hervorragenden mehrsprachigen (deutschen) Leistung.
*   **Warum läuft die Vektormathematik isoliert in der `RPC: match_documents` Methode?**
    Um extreme Netzwerkeffizienzen zu generieren. Statt 10.000 generische Floating-Arrays durch das HTTPS-Nadelöhr in das Next.js Backend zu ziehen, um dort via Javascript zu sortieren, zwingt der Server die postgres-interne C++ Ebene via RPC, die Cosine Distanz (`<=>`) lokal auszuführen. Es fließen nur die 5 Textknoten durch das Kabel zurück.

### Phase 3: Generative Proxy Invocation
*   **Warum die Isolation der LLMs durch `OpenRouter`?**
    "Blind Generation" Design: Wir übermitteln dem ausführenden Generator ausschließlich saubere Textanweisungen. OpenRouter erlaubt es zudem, das finale Modell im Frontend ohne Zero-Day-Deployments jederzeit umzuschalten ("Hot-Swapping" von Gemini auf DeepSeek auf Llama).

### Phase 4: Payload Parsing & Native Render
*   **Warum das Abfangen der Ausgaben mit einer `Regex`-Logik anstelle der Nutzung nativer Vision LLMs?**
    Hunderte Verkehrszeichen in der Ingestion-Phase von echten KI-Augen dekonstruieren zu lassen führt zwangsläufig in den finanziellen Bankrott und treibt Latenzen ins Unermessliche. Indem unser ETL-Skript den XML `<img/>` Code durch reine Text-Anker (`[BILD...]`) austauscht, denken unsere LLMs, sie transferieren Texte. Das Frontend-React entdeckt (via Regex) diese Anweisungen im Millisekundentakt, kappt den Textstrang und mounted lokal abgelegte `.jpg` Dateien direkt im DOM. 100% Overhead-freie Multimodalität.

## 7. Architektonische Einschränkungen (Technical Debt)

Um dieses End-to-End System schnell zu iterieren, gibt es architektonische Schulden:

1. **Schwache Namespace-Sicherheit (RLS via Frontend)**: Aktuell wählt der Client den Tenant über das Plaintext-Parameter `tenant_id` (`POST`). Für öffentliche Lexika vertretbar, im Corporate/SaaS-Bereich muss eine zwingende serverseitige Begrenzung über kryptografische JWT-Session-Tokens eingeführt werden.
2. **Dimensions-Modell-Kopplung**: Die Datenbank speichert 3072-dimensionale Vektoren, generiert durch `gemini-embedding-001`. Ein Wechsel zu einem anderen Embedding-Modell mit abweichender Ausgabedimension erfordert eine vollständige Neuindizierung aller Daten.
3. **Naive Recall Bias (Einphasen-Abruf)**: Das System vertraut bei den Top-K Treffern derzeit blind der reinen "Nearest-Neighbor" Distanz. Bei der Skalierung auf riesige Korpora ist im Backend ein nachgeschalteter **Cross-Encoder Reranker** (z. B. Cohere Rerank) unerlässlich, bevor der Kontext an das LLM geschickt wird.
