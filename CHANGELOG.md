# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-16

### Added
- **Enterprise Hardening**: Implemented PostgreSQL **Row Level Security (RLS)** with `SECURITY INVOKER` logic for secured multi-tenancy.
- **Shared AI Library**: Centralized API resilience logic in `src/lib/ai-client.ts` featuring exponential backoff retries.
- **Idempotent Ingestion**: Added SHA-256 content hashing to the ETL pipeline to prevent data duplication.
- **Multimodal Regex Engine**: Integrated a zero-cost image interception layer for 250+ traffic signs without Vision-LLM overhead.
- **Automated Health Check**: Added `npm run health` (diagnose.mjs) for validating DB connectivity, vector dimensions (3072), and RLS isolation.
- **Bilingual Documentation**: Full English & German architecture walkthroughs in README.md.

### Engineering Rationale
- Decoupled ingestion (scripts/) from production runtime (src/).
- Enforced 3072-dimensional vector schema for high-fidelity legal text retrieval.
- Implemented Strategy Pattern for universal document parsing (XML/MD/TXT).

---
*Status: Production-Ready MVP*
