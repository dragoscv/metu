/**
 * Root Suspense boundary — required under cacheComponents because the
 * authenticated (app) layout performs uncached IO (auth() + DB) before
 * any nested loading boundary mounts.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)]">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-brand)]" />
    </div>
  );
}
