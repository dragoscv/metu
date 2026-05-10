/**
 * Robust structured-output helper around AI SDK v5 `generateObject`.
 *
 * Why this exists:
 *   Some providers (notably the GitHub Copilot proxy, which serves many
 *   different upstream models) don't reliably honor `response_format:
 *   json_schema` or `tool_choice: required` for `generateObject`. A typical
 *   failure mode is the model wrapping JSON in ```json ... ``` fences or
 *   prefixing it with prose, which causes AI SDK to throw `NoObjectGenerated:
 *   could not parse the response.`
 *
 * What this does:
 *   1. Calls `generateObject` with `experimental_repairText` that strips the
 *      most common wrappers (markdown fences, leading prose) before parsing.
 *   2. On any failure, falls back to `generateText` with a strict
 *      "JSON only" system suffix, extracts the first balanced JSON object
 *      from the response, and validates it against the Zod schema.
 *
 * Use this anywhere you would have used `generateObject` directly.
 */
import { generateObject, generateText, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';

/**
 * `model` is whatever the AI SDK accepts on its `generateObject` input. We
 * derive it from the SDK's own parameter shape so this stays in sync with
 * AI SDK v5 upgrades without leaking `any`.
 */
type AIModel = Parameters<typeof generateObject>[0]['model'];

export interface GenerateStructuredInput<T> {
  model: AIModel;
  schema: z.ZodType<T>;
  schemaName?: string;
  schemaDescription?: string;
  system?: string;
  prompt: string;
  /** Maximum chars of repaired text we will attempt to parse. */
  maxRepairChars?: number;
}

export async function generateStructured<T>(
  input: GenerateStructuredInput<T>,
): Promise<{ object: T; via: 'generateObject' | 'generateText-fallback' }> {
  const repair = ({ text }: { text: string }) => {
    const cleaned = stripJsonWrappers(text);
    return cleaned ?? text;
  };

  try {
    const { object } = await generateObject({
      model: input.model,
      system: input.system,
      schema: input.schema,
      schemaName: input.schemaName,
      schemaDescription: input.schemaDescription,
      prompt: input.prompt,
      experimental_repairText: async ({ text }) => repair({ text }),
    });
    return { object: object as T, via: 'generateObject' };
  } catch (err) {
    // Only fall back on the specific "couldn't parse" class of error. Any
    // other failure (auth, rate limit, network) bubbles up.
    if (!(err instanceof NoObjectGeneratedError)) {
      throw err;
    }
  }

  // Fallback: bypass `generateObject` entirely. The Copilot proxy and some
  // OpenAI-compatible servers don't honor structured-output negotiation
  // reliably — the model returns prose. We force JSON-only behavior with a
  // strict, dedicated system prompt that REPLACES the caller's system (the
  // caller's system gets demoted into the user prompt as "Context") so the
  // model can't fall back into chat mode.
  let schemaJson = '';
  try {
    schemaJson = JSON.stringify(z.toJSONSchema(input.schema), null, 2);
  } catch {
    schemaJson = '';
  }
  const fallbackSystem = [
    'You are a strict JSON generator. You output exactly one JSON object — nothing else.',
    'Rules:',
    '  - Output ONLY a single JSON object. No prose, no greetings, no markdown fences, no explanations.',
    '  - The first character of your response must be `{`. The last character must be `}`.',
    '  - Match the JSON Schema exactly. Include every required field. Use the exact enum values where specified.',
    schemaJson ? `\nJSON Schema:\n${schemaJson}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const contextBlock = input.system
    ? `Context (use this to inform the JSON, but do not reply to it conversationally):\n${input.system}\n\n`
    : '';
  const fallbackPrompt = `${contextBlock}User input:\n${input.prompt}\n\nNow produce the JSON object.`;

  const { text } = await generateText({
    model: input.model,
    system: fallbackSystem,
    prompt: fallbackPrompt,
    temperature: 0,
  });

  const candidate = stripJsonWrappers(text) ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const balanced = extractFirstJsonObject(candidate);
    if (!balanced) {
      throw new Error(
        `Model did not return parseable JSON. First 200 chars: ${candidate.slice(0, 200)}`,
      );
    }
    parsed = JSON.parse(balanced);
  }

  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Model JSON did not match schema: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return { object: result.data, via: 'generateText-fallback' };
}

/**
 * Strip the common wrappers some chat models put around JSON: markdown code
 * fences (```json ... ```), leading/trailing prose, BOMs, etc. Returns null
 * if no recognizable wrapper was present (caller can fall through to the raw
 * text).
 */
function stripJsonWrappers(raw: string): string | null {
  let text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return null;

  // ```json … ``` or ``` … ```
  const fence = text.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fence?.[1]) {
    return fence[1].trim();
  }

  // Sometimes prose precedes the object — try to slice from the first '{' to
  // the matching closing '}'. Same for arrays.
  const balanced = extractFirstJsonObject(text);
  if (balanced && balanced !== text) return balanced;

  return null;
}

/**
 * Extract the first balanced JSON object/array from a string, ignoring
 * braces inside string literals. Returns null if none found.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = findFirstUnquoted(text, ['{', '[']);
  if (start < 0) return null;
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function findFirstUnquoted(text: string, chars: string[]): number {
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (chars.includes(ch)) return i;
  }
  return -1;
}
