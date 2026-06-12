/**
 * /docs/companion — Tauri desktop companion overview + capability gating.
 */

export default async function DocsCompanionPage() {
  'use cache';
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Companion (desktop)</h1>
      <p className="text-[var(--color-fg-subtle)]">
        Tauri 2 shell that gives metu eyes and hands on your machine: capture from any window,
        wake-word listening, optional Ollama bridge, and capability-gated screen + a11y access.
      </p>

      <h2>Install</h2>
      <p>
        Download from <a href="/download">/download</a> or build from source under{' '}
        <code>apps/companion</code>.
      </p>

      <h2>Pair with your workspace</h2>
      <p>
        On first launch the companion shows a 6-character device code. Visit{' '}
        <a href="/companion/connect">/companion/connect</a> in the web app and paste it. The pairing
        mints a bearer token scoped to the device.
      </p>

      <h2>Capabilities</h2>
      <p>
        Sensitive surfaces (screenshot, window list, accessibility tree, input synthesis, shell) are
        default-deny. Toggle them per-device; metu refuses any tool call whose capability is
        disabled.
      </p>
      <ul>
        <li>
          <code>screenshot</code> — capture screen / window pixels
        </li>
        <li>
          <code>windows_read</code> — enumerate open windows
        </li>
        <li>
          <code>a11y_read</code> — read the accessibility tree
        </li>
        <li>
          <code>a11y_invoke</code> — click / set value via accessibility APIs
        </li>
        <li>
          <code>input</code> — synthesise keyboard / mouse events
        </li>
        <li>
          <code>shell</code> — execute shell commands (always asks first)
        </li>
      </ul>

      <h2>Updates</h2>
      <p>
        Companion auto-updates against a Cloudflare-hosted manifest. Releases are signed with the
        Tauri private key — see <code>infra/cloudflare/companion-updater</code>.
      </p>
    </article>
  );
}
