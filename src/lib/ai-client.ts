/**
 * Shared AI Client — Centralized retry/resilience logic for embedding APIs.
 *
 * Used by: src/app/api/chat/route.ts (Next.js runtime)
 *
 * [CROSS-REFERENCE] A functionally equivalent copy of `fetchWithBackoff`
 * exists in scripts/ingest_universal.mjs for the offline ETL pipeline,
 * because Node.js .mjs cannot natively import TypeScript modules.
 * If you modify the retry logic here, update both locations.
 */

/**
 * Generates an embedding vector for the given text using Gemini Embedding API,
 * with exponential backoff retry on transient failures (429, 5xx).
 *
 * @param text - The text to embed
 * @param apiKey - Gemini API key
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The embedding vector as number[]
 * @throws Error after all retries are exhausted
 */
export async function embedWithRetry(
  text: string,
  apiKey: string,
  maxRetries: number = 3
): Promise<number[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      return data.embedding.values;
    }

    const errText = await res.text();

    // Abort early on permanent client errors (except Rate Limit 429)
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new Error(`Permanent client error: ${res.status} ${errText}`);
    }

    console.error(
      `[ai-client] Embedding attempt ${attempt + 1}/${maxRetries} failed: ${res.status} ${errText} - Retrying...`
    );

    if (attempt + 1 >= maxRetries) {
      throw new Error(
        `Embedding failed after ${maxRetries} attempts: ${res.status} ${errText}`
      );
    }

    // Exponential backoff: 1s, 2s, 4s...
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 * Math.pow(2, attempt))
    );
  }

  // TypeScript exhaustiveness — should never reach here
  throw new Error('Unexpected: retry loop exited without result');
}
