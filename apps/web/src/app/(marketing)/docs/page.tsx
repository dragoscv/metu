/**
 * /docs — public quickstart. Hand-authored Markdown rendered server-side
 * via plain JSX (no MDX runtime dependency yet). Linked from the
 * marketing header and from the SDK error pages.
 */
export const dynamic = 'force-static';
export const revalidate = 3600;

export default function DocsIndex() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>metu in 60 seconds</h1>
      <p className="text-[var(--color-fg-subtle)]">
        metu is a Personal AI Operating System: a central console that observes you across surfaces
        (web, mobile, VS Code, browser, Tauri companion, MCP) and runs a continuous Conductor agent
        that plans, asks for permission, calls tools, and notifies your devices.
      </p>

      <h2>1. Sign in</h2>
      <p>
        Open <a href="/sign-in">/sign-in</a> with GitHub or Google. The first sign-in provisions a
        personal workspace.
      </p>

      <h2>2. Bring your own AI key</h2>
      <p>
        metu does not resell tokens. Add an OpenAI / Anthropic / Google key — or connect GitHub
        Copilot via OAuth — at <a href="/settings">/settings</a>. Keys are sealed with AES-256-GCM
        and stored per workspace.
      </p>

      <h2>3. Capture, recall, resume</h2>
      <ul>
        <li>
          <strong>Capture</strong> — anything you type, dictate, or paste flows into your second
          brain. The browser extension and VS Code extension capture from any page or selection.
        </li>
        <li>
          <strong>Recall</strong> — semantic + keyword hybrid search over everything you have ever
          captured. Use <code>/recall &lt;query&gt;</code> in chat or the command palette.
        </li>
        <li>
          <strong>Resume</strong> — at any time the Conductor can answer "what was I doing?" by
          pulling the last 3d / 3w / 3m of activity per project and producing a one-screen briefing.
        </li>
      </ul>

      <h2>4. SDK</h2>
      <p>
        Build your own metu-aware app. Issue a bearer token at{' '}
        <a href="/settings/api-tokens">/settings/api-tokens</a> and call:
      </p>
      <pre>
        <code>{`curl -X POST https://app.metu.ro/api/sdk/v1/capture \\
  -H "authorization: Bearer $METU_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"kind":"note","content":"hello world"}'`}</code>
      </pre>

      <h2>Where next</h2>
      <ul>
        <li>
          Telegram triage bot — <a href="/settings/integrations/telegram">connect your chat</a> and{' '}
          <code>/capture</code> from anywhere.
        </li>
        <li>
          Mobile companion — install the Expo app and pair it under <a href="/settings">Settings</a>
          .
        </li>
        <li>
          Tauri desktop companion — single-click capture, hotkey wake-word, optional Ollama bridge.
        </li>
      </ul>
    </article>
  );
}
