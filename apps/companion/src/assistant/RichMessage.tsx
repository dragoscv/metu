/**
 * RichMessage — smart chat content for bubble + chat panel (Jarvis v4).
 *
 * Renders assistant text as structured blocks instead of a flat string:
 *   - GitHub-flavored markdown (lists, tables, bold, headings, links)
 *   - code cards: language badge + one-tap copy
 *   - image cards: skeleton shimmer while loading, click-to-zoom overlay
 *   - link preview cards: bare URLs on their own line become open cards
 *   - entity cards: `metu://task/<id>`-style refs deep-link into the console
 *
 * Security: react-markdown never renders raw HTML; external links open via
 * the Tauri opener (system browser), never in-webview navigation.
 */
import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { isTauri } from '../state/runtime';

function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) void openUrl(url).catch(() => {});
  else window.open(url, '_blank', 'noopener');
}

async function copy(text: string): Promise<void> {
  try {
    if (isTauri()) await writeText(text);
    else await navigator.clipboard.writeText(text);
  } catch {
    /* best-effort */
  }
}

// ── entity refs: metu://<kind>/<id> → console deep link cards ─────────────
const ENTITY_RE = /metu:\/\/(task|project|goal|timeline|capture)\/([a-zA-Z0-9-]+)/g;

const ENTITY_META: Record<string, { icon: string; label: string; path: (id: string) => string }> = {
  task: { icon: '☑️', label: 'Task', path: (id) => `/tasks?task=${id}` },
  project: { icon: '📁', label: 'Project', path: (id) => `/projects/${id}` },
  goal: { icon: '🎯', label: 'Goal', path: (id) => `/goals?goal=${id}` },
  timeline: { icon: '🕒', label: 'Timeline', path: () => `/timeline` },
  capture: { icon: '📸', label: 'Capture', path: (id) => `/captures?capture=${id}` },
};

function EntityCard({ kind, id, apiBase }: { kind: string; id: string; apiBase?: string }) {
  const meta = ENTITY_META[kind];
  if (!meta) return null;
  return (
    <button
      type="button"
      className="rmsg__entity"
      onClick={() => apiBase && openExternal(`${apiBase.replace(/\/$/, '')}${meta.path(id)}`)}
      title="Open in metu console"
    >
      <span className="rmsg__entity-icon">{meta.icon}</span>
      <span className="rmsg__entity-body">
        <span className="rmsg__entity-kind">{meta.label}</span>
        <span className="rmsg__entity-id">{id.slice(0, 8)}…</span>
      </span>
      <span className="rmsg__entity-go">↗</span>
    </button>
  );
}

// ── code card ──────────────────────────────────────────────────────────────
function CodeCard({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rmsg__code">
      <div className="rmsg__code-head">
        <span className="rmsg__code-lang">{lang || 'code'}</span>
        <button
          type="button"
          className="rmsg__code-copy"
          onClick={() => {
            void copy(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="rmsg__code-body">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── image card: shimmer → fade-in → click-to-zoom ─────────────────────────
function ImageCard({ src, alt }: { src: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  if (failed) return <span className="rmsg__img-fail">🖼 image unavailable</span>;
  return (
    <>
      <span className={`rmsg__img ${loaded ? 'rmsg__img--loaded' : ''}`}>
        {!loaded && <span className="rmsg__skeleton" aria-hidden />}
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          onClick={() => setZoom(true)}
        />
      </span>
      {zoom && (
        <span className="rmsg__zoom" onClick={() => setZoom(false)}>
          <img src={src} alt={alt ?? ''} />
        </span>
      )}
    </>
  );
}

// ── link preview card (bare URL on its own paragraph) ─────────────────────
function LinkCard({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep raw */
  }
  return (
    <button type="button" className="rmsg__link" onClick={() => openExternal(url)}>
      <span className="rmsg__link-favicon" aria-hidden>
        🌐
      </span>
      <span className="rmsg__link-body">
        <span className="rmsg__link-host">{host}</span>
        <span className="rmsg__link-url">{url.length > 56 ? `${url.slice(0, 56)}…` : url}</span>
      </span>
      <span className="rmsg__entity-go">↗</span>
    </button>
  );
}

const BARE_URL_RE = /^https?:\/\/\S+$/;
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i;

export const RichMessage = memo(function RichMessage({
  text,
  apiBase,
}: {
  text: string;
  /** Console base URL for entity deep links (auth.apiBase). */
  apiBase?: string;
}) {
  // Pre-pass: split out entity refs so they render as cards.
  const segments = useMemo(() => {
    const out: Array<{ kind: 'md' | 'entity'; value: string; id?: string; entity?: string }> = [];
    let last = 0;
    for (const m of text.matchAll(ENTITY_RE)) {
      if (m.index! > last) out.push({ kind: 'md', value: text.slice(last, m.index) });
      out.push({ kind: 'entity', value: m[0], entity: m[1], id: m[2] });
      last = m.index! + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'md', value: text.slice(last) });
    return out;
  }, [text]);

  return (
    <div className="rmsg">
      {segments.map((seg, i) =>
        seg.kind === 'entity' ? (
          <EntityCard key={i} kind={seg.entity!} id={seg.id!} apiBase={apiBase} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    if (href) openExternal(href);
                  }}
                >
                  {children}
                </a>
              ),
              img: ({ src, alt }) =>
                typeof src === 'string' ? <ImageCard src={src} alt={alt} /> : null,
              p: ({ children, node }) => {
                // Bare URL paragraph → link card (or image card for images).
                const only = node?.children.length === 1 ? node.children[0] : null;
                if (only && only.type === 'text' && BARE_URL_RE.test(only.value.trim())) {
                  const url = only.value.trim();
                  return IMAGE_URL_RE.test(url) ? <ImageCard src={url} /> : <LinkCard url={url} />;
                }
                return <p>{children}</p>;
              },
              code: ({ className, children, node }) => {
                const value = String(children).replace(/\n$/, '');
                // Block code (has a language class or newlines) → code card.
                const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
                const isBlock =
                  !!lang ||
                  value.includes('\n') ||
                  node?.position?.start.line !== node?.position?.end.line;
                return isBlock ? (
                  <CodeCard lang={lang} code={value} />
                ) : (
                  <code className="rmsg__inline-code">{value}</code>
                );
              },
            }}
          >
            {seg.value}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
});

// ── live progress / step card (multi-step act + terminal) ─────────────────
export interface StepCardStep {
  label: string;
  state: 'pending' | 'running' | 'done' | 'failed';
}

export function StepCard({ title, steps }: { title: string; steps: StepCardStep[] }) {
  return (
    <div className="rmsg__steps">
      <div className="rmsg__steps-title">{title}</div>
      {steps.map((s, i) => (
        <div key={i} className={`rmsg__step rmsg__step--${s.state}`}>
          <span className="rmsg__step-icon">
            {s.state === 'done'
              ? '✓'
              : s.state === 'failed'
                ? '✕'
                : s.state === 'running'
                  ? ''
                  : '○'}
            {s.state === 'running' && <span className="rmsg__spinner" aria-hidden />}
          </span>
          <span className="rmsg__step-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
