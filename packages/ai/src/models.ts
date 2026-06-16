/**
 * Curated catalog of usable models per provider, keyed by AI intent.
 *
 * The UI uses this to populate model dropdowns on the Settings page. Users
 * can also type a custom model id (e.g. fine-tunes, Copilot dynamic models).
 *
 * Keep entries conservative: only models that we are confident the AI SDK
 * adapter can talk to. Add new ones as providers ship them.
 */
import type { AiIntent, AiProvider } from '@metu/types';

export interface ModelEntry {
  id: string;
  label: string;
  /** Intents this model is suitable for. */
  intents: AiIntent[];
}

const reasoning: AiIntent[] = ['reasoning', 'agentic', 'chat'];
const all: AiIntent[] = ['reasoning', 'agentic', 'fast', 'chat', 'vision'];

export const MODEL_CATALOG: Record<AiProvider, ModelEntry[]> = {
  anthropic: [
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', intents: reasoning },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', intents: all },
    { id: 'claude-haiku-4', label: 'Claude Haiku 4', intents: ['fast'] },
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', intents: all },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', intents: ['fast'] },
  ],
  openai: [
    { id: 'gpt-5', label: 'GPT-5', intents: reasoning },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', intents: ['fast', 'agentic'] },
    { id: 'gpt-4.1', label: 'GPT-4.1', intents: all },
    { id: 'gpt-4o', label: 'GPT-4o', intents: all },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', intents: ['fast'] },
    { id: 'o3', label: 'o3 (reasoning)', intents: reasoning },
    { id: 'o3-mini', label: 'o3-mini', intents: reasoning },
    { id: 'text-embedding-3-small', label: 'Embed: 3-small', intents: ['embed'] },
    { id: 'text-embedding-3-large', label: 'Embed: 3-large', intents: ['embed'] },
    { id: 'whisper-1', label: 'Whisper-1', intents: ['transcribe'] },
  ],
  azure_openai: [
    { id: 'gpt-5', label: 'GPT-5 (deployment)', intents: reasoning },
    { id: 'gpt-4o', label: 'GPT-4o (deployment)', intents: all },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini (deployment)', intents: ['fast'] },
    { id: 'text-embedding-3-small', label: 'Embed: 3-small', intents: ['embed'] },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', intents: all },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', intents: ['fast', 'agentic'] },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', intents: ['fast'] },
    { id: 'text-embedding-004', label: 'Embed: text-embedding-004', intents: ['embed'] },
  ],
  vertex: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', intents: all },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', intents: ['fast'] },
  ],
  copilot: [
    { id: 'claude-opus-4', label: 'Claude Opus 4 (Copilot)', intents: reasoning },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4 (Copilot)', intents: all },
    { id: 'claude-3.7-sonnet', label: 'Claude 3.7 Sonnet (Copilot)', intents: all },
    { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (Copilot)', intents: all },
    { id: 'gpt-5', label: 'GPT-5 (Copilot)', intents: reasoning },
    { id: 'gpt-5-mini', label: 'GPT-5 mini (Copilot)', intents: ['fast', 'agentic'] },
    { id: 'gpt-4.1', label: 'GPT-4.1 (Copilot)', intents: all },
    { id: 'gpt-4o', label: 'GPT-4o (Copilot)', intents: all },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini (Copilot)', intents: ['fast'] },
    { id: 'o3-mini', label: 'o3-mini (Copilot)', intents: reasoning },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Copilot)', intents: all },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Copilot)', intents: ['fast'] },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2', intents: ['fast'] },
    { id: 'qwen2.5:14b', label: 'Qwen 2.5 14b', intents: ['fast', 'agentic'] },
    { id: 'nomic-embed-text', label: 'Nomic Embed', intents: ['embed'] },
  ],
  custom: [],
  codai: [
    // First-class codai gateway (ai.codai.ro). The `codai` alias auto-routes
    // to the best upstream; the rest pin a tier directly.
    { id: 'codai', label: 'Codai (auto router)', intents: all },
    { id: 'codai-fast', label: 'Codai (fast)', intents: ['fast', 'agentic'] },
    { id: 'codai-vision', label: 'Codai (vision)', intents: ['vision', 'agentic'] },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (Codai)', intents: reasoning },
    // Embeddings: codai serves text-embedding-3-small natively (Azure-backed,
    // 1536-dim — matches the pgvector column) plus the codai-embed sentinel
    // that routes to the platform default. Keep 3-small as the metu default
    // so dims never drift.
    { id: 'text-embedding-3-small', label: 'Embed: 3-small (1536)', intents: ['embed'] },
    { id: 'codai-embed', label: 'Embed: codai default', intents: ['embed'] },
    // Audio: whisper-compatible STT at /v1/audio/transcriptions and TTS at
    // /v1/audio/speech (gateway proxies to Azure codai-foundry deployments).
    { id: 'codai-transcribe', label: 'Transcribe: Whisper (Codai)', intents: ['transcribe'] },
    { id: 'gpt-4o-mini-transcribe', label: 'Transcribe: 4o-mini (Codai)', intents: ['transcribe'] },
  ],
  // Voice providers — no LLM models. Listed only so MODEL_CATALOG matches
  // the AiProvider union (extended for BYOK voice keys in slice 5b).
  deepgram: [],
  cartesia: [],
  elevenlabs: [],
};

export function modelsForIntent(provider: AiProvider, intent: AiIntent): ModelEntry[] {
  return MODEL_CATALOG[provider].filter((m) => m.intents.includes(intent));
}
