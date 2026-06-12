/**
 * /docs/security — what we do and what we don't do with your data.
 */

export default async function DocsSecurityPage() {
  'use cache';
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Security</h1>

      <h2>BYOK — bring your own key</h2>
      <p>
        metu does not resell tokens. Every third-party credential (OpenAI, Anthropic, Google,
        Deepgram, ElevenLabs, integrations OAuth tokens) is sealed with AES-256-GCM at rest and
        decrypted only on the request path that needs it.
      </p>

      <h2>Workspace isolation</h2>
      <p>
        Every domain row carries a <code>workspace_id</code>. Every query and Server Action filters
        by the resolved workspace; cross-tenant reads / writes are guarded by linter rules and
        runtime tests in CI.
      </p>

      <h2>Logging</h2>
      <p>
        Console logs are scrubbed before they leave the process: bearer headers, JWTs,{' '}
        <code>metu_at_*</code> tokens, and known sensitive keys are redacted. Long payloads pass
        through untouched (truncating risks corrupting structured logs).
      </p>

      <h2>OAuth scopes</h2>
      <p>
        SDK bearer tokens are scoped (<code>capture:write</code>, <code>recall:read</code>,{' '}
        <code>tools:invoke</code>, etc.). Issuance happens through standard OAuth2 PKCE; revoke any
        token you don't recognise at <a href="/settings/api-tokens">/settings/api-tokens</a>.
      </p>

      <h2>Capability gates</h2>
      <p>
        The desktop companion treats screen capture, accessibility access, input synthesis, and
        shell execution as separate capabilities — all default-deny.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        Email <code>security@metu.ro</code>. We respond within 48h.
      </p>
    </article>
  );
}
