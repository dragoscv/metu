/**
 * Suspense boundary for the consent page — required under cacheComponents
 * because the page reads searchParams + session (uncached IO) at top level.
 */
export default function AuthorizeLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)]">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-brand)]" />
    </div>
  );
}
