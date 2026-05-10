/**
 * Tauri auto-update — runtime hook + UI.
 *
 * On startup we ask the updater plugin to check `releases.metu.app/companion/latest.json`
 * (configured in `tauri.conf.json`). If a newer signed bundle is available
 * we surface a non-modal banner with "Install & restart". Errors (no
 * connection, no signing key configured, no update) are swallowed so the
 * app behaves identically when release infra isn't fully wired yet.
 *
 * NOTE: signing key + release endpoint are placeholders — the wire-up
 * lands here so the moment we ship a private key + GH releases pipeline,
 * the user just opens the app and sees the prompt.
 */
import { useCallback, useEffect, useState } from 'react';

interface UpdateInfo {
  version: string;
  notes?: string | null;
  downloadAndInstall: (cb?: (e: { event: string }) => void) => Promise<void>;
}

export function useUpdater(): {
  available: UpdateInfo | null;
  status: 'idle' | 'checking' | 'downloading' | 'installing' | 'error';
  error: string | null;
  install: () => Promise<void>;
  recheck: () => void;
} {
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'downloading' | 'installing' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus('checking');
    setError(null);
    try {
      // Loaded dynamically so dev / browser builds (no Tauri runtime)
      // don't crash on the import itself. The package is optional —
      // when it's not installed the import resolves to null and we
      // silently no-op.
      const mod = (await import(
        /* @vite-ignore */
        '@tauri-apps/plugin-updater'
      ).catch(() => null)) as {
        check: () => Promise<{
          version: string;
          body?: string | null;
          available?: boolean;
          downloadAndInstall: (cb?: (e: { event: string }) => void) => Promise<void>;
        } | null>;
      } | null;
      if (!mod) {
        setStatus('idle');
        return;
      }
      const update = await mod.check();
      // Tauri 2.x returns `null` when no update is available. Older shape
      // returned `{ available: false }`; handle both.
      if (!update || update.available === false) {
        setStatus('idle');
        setAvailable(null);
        return;
      }
      setAvailable({
        version: update.version,
        notes: update.body ?? null,
        downloadAndInstall: update.downloadAndInstall,
      });
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const install = useCallback(async () => {
    if (!available) return;
    setStatus('downloading');
    setError(null);
    try {
      await available.downloadAndInstall((evt) => {
        if (evt.event === 'Started') setStatus('downloading');
        if (evt.event === 'Finished') setStatus('installing');
      });
      // App restarts itself after install.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [available]);

  return { available, status, error, install, recheck: check };
}

interface BannerProps {
  className?: string;
}

export function UpdateBanner({ className }: BannerProps) {
  const { available, status, error, install } = useUpdater();
  if (!available) return null;
  return (
    <div
      className={className ?? 'card'}
      style={{
        background: 'rgba(124, 58, 237, 0.12)',
        border: '1px solid rgba(124, 58, 237, 0.5)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong>Update available — v{available.version}</strong>
          {available.notes ? (
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {available.notes}
            </p>
          ) : null}
        </div>
        <button className="btn" onClick={install} disabled={status !== 'idle'}>
          {status === 'idle'
            ? 'Install & restart'
            : status === 'downloading'
              ? 'Downloading…'
              : 'Installing…'}
        </button>
      </div>
      {error ? (
        <p className="muted" style={{ fontSize: 11, color: '#f88', marginTop: 6 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
