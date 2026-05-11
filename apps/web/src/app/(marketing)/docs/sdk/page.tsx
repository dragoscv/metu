/**
 * /docs/sdk — bearer token usage + a runnable curl per endpoint.
 */
export const dynamic = 'force-static';
export const revalidate = 3600;

export default function DocsSdkPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>SDK</h1>
      <p className="text-[var(--color-fg-subtle)]">
        Build your own metu-aware app. All endpoints live under{' '}
        <code>https://app.metu.ro/api/sdk/v1</code> and accept a bearer token in the{' '}
        <code>Authorization</code> header.
      </p>

      <h2>Auth</h2>
      <p>
        Mint a token at <a href="/settings/api-tokens">/settings/api-tokens</a>. Scopes are
        space-delimited; the bearer call fails 403 if the scope is missing.
      </p>

      <h2>Capture</h2>
      <pre>
        <code>{`curl -X POST https://app.metu.ro/api/sdk/v1/capture \\
  -H "authorization: Bearer $METU_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"kind":"note","content":"hello world"}'`}</code>
      </pre>

      <h2>Recall</h2>
      <pre>
        <code>{`curl -X POST https://app.metu.ro/api/sdk/v1/recall \\
  -H "authorization: Bearer $METU_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"query":"that thing about postgres"}'`}</code>
      </pre>

      <h2>Resume</h2>
      <pre>
        <code>{`curl https://app.metu.ro/api/sdk/v1/resume?projectId=$PID \\
  -H "authorization: Bearer $METU_TOKEN"`}</code>
      </pre>

      <h2>Brief</h2>
      <p>On-demand briefing for a project. Triggers continuity restoration server-side.</p>
      <pre>
        <code>{`curl -X POST https://app.metu.ro/api/sdk/v1/brief \\
  -H "authorization: Bearer $METU_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"projectId":"<uuid>"}'`}</code>
      </pre>

      <h2>Notify</h2>
      <pre>
        <code>{`curl -X POST https://app.metu.ro/api/sdk/v1/notify \\
  -H "authorization: Bearer $METU_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"title":"Build done","body":"main green","urgency":"low"}'`}</code>
      </pre>
    </article>
  );
}
