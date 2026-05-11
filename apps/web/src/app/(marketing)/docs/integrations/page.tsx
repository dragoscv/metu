/**
 * /docs/integrations — third-party integrations metu can drive.
 */
export const dynamic = 'force-static';
export const revalidate = 3600;

export default function DocsIntegrationsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Integrations</h1>
      <p className="text-[var(--color-fg-subtle)]">
        Once you connect an integration on <a href="/integrations">/integrations</a>, metu can
        capture from it, search it, and (with autonomy enabled) act on it.
      </p>

      <h2>OAuth-grant integrations</h2>
      <ul>
        <li>
          <strong>GitHub</strong> — issues, PRs, commits, code search.
        </li>
        <li>
          <strong>Google</strong> — Calendar, Drive, Gmail (read).
        </li>
        <li>
          <strong>Telegram</strong> — link your chat with <code>/start &lt;code&gt;</code> in the
          metu bot. Use <code>/capture</code> and <code>/recall</code> from any chat.
        </li>
        <li>
          <strong>Stripe</strong> — billing portal + subscription tier propagation.
        </li>
      </ul>

      <h2>SDK satellites</h2>
      <p>
        Apps you build (notai, mmo, …) authenticate through metu via OAuth2 PKCE and exchange events
        through the hub. Use the <a href="/docs/sdk">SDK reference</a>.
      </p>

      <h2>Borrowed credentials</h2>
      <p>
        The <code>creds:borrow</code> SDK scope lets your app fetch a short-lived upstream token
        (e.g. a user's GitHub token) without storing the OAuth grant. Borrow requires
        per-integration autonomy set to <code>auto-with-undo</code> or <code>autopilot</code>.
      </p>
    </article>
  );
}
