/**
 * /docs/byok — bring your own AI key model.
 */
export const dynamic = 'force-static';
export const revalidate = 3600;

export default function DocsByokPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Bring your own key (BYOK)</h1>
      <p className="text-[var(--color-fg-subtle)]">
        metu does not resell tokens. Every AI call is billed against a key you control.
      </p>

      <h2>Supported providers</h2>
      <ul>
        <li>
          <strong>OpenAI</strong> — chat, embeddings, realtime voice, transcription.
        </li>
        <li>
          <strong>Anthropic</strong> — chat, tool use.
        </li>
        <li>
          <strong>Google AI</strong> — Gemini chat + multimodal.
        </li>
        <li>
          <strong>Deepgram</strong> — streaming transcription.
        </li>
        <li>
          <strong>ElevenLabs</strong> — text-to-speech.
        </li>
        <li>
          <strong>GitHub Copilot</strong> — connected via OAuth, used for chat.
        </li>
        <li>
          <strong>Ollama</strong> — local models; the desktop companion bridges localhost to the web
          via a signed device link.
        </li>
      </ul>

      <h2>How keys are stored</h2>
      <p>
        Sealed with AES-256-GCM. The encryption key never leaves the server process; ciphertext + IV
        + tag live in <code>provider_credential</code> per workspace. We expose a "test" button that
        pings the provider's list-models endpoint to verify the key without storing anything.
      </p>

      <h2>Free vs paid</h2>
      <p>
        The free tier allows a single provider credential. Add more on Starter and above —
        plan-gating happens at write time, not on the model selector.
      </p>

      <h2>Routing</h2>
      <p>
        The planner picks a provider per task: cheap fast models for triage, larger models for
        research / continuity briefings. You can pin a provider per project on{' '}
        <a href="/settings">/settings</a>.
      </p>
    </article>
  );
}
