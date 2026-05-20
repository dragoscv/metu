/**
 * EmptyHeartbeat — shared empty-state surface for every skin.
 *
 * Each skin passes its own copy so the metaphor stays consistent
 * (a still sky vs. a calm river vs. fallow ground).
 */
export interface EmptyHeartbeatProps {
  title: string;
  hint: string;
  /** Single emoji-grade glyph rendered large and dim. */
  glyph?: string;
}

export function EmptyHeartbeat({ title, hint, glyph = '·' }: EmptyHeartbeatProps) {
  return (
    <div
      role="status"
      className="bg-[var(--color-night-deep)]/50 relative flex aspect-[16/9] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-[var(--color-border)] text-center"
    >
      <div
        aria-hidden
        className="text-[var(--color-mist)]/40 text-6xl font-light"
        style={{ lineHeight: 1 }}
      >
        {glyph}
      </div>
      <div className="text-sm text-[var(--color-fg-muted)]">{title}</div>
      <div className="max-w-xs px-4 text-xs text-[var(--color-fg-subtle)]">{hint}</div>
    </div>
  );
}
