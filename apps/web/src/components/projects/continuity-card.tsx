'use client';
/**
 * Continuity card — renders the latest "where was I?" briefing for a project
 * with a button to regenerate it. Lives at the top of the project detail
 * page so the user lands on context, not a wall of tasks.
 */
import { useState, useTransition } from 'react';
import { Sparkles, RefreshCcw, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardTitle, Button } from '@metu/ui';
import { restoreContextAction, type BriefingRow } from '@/app/actions/continuity';

interface Props {
  projectId: string;
  initial: BriefingRow | null;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)} h ago`;
  return `${Math.round(diffSec / 86_400)} d ago`;
}

export function ContinuityCard({ projectId, initial }: Props) {
  const [latest, setLatest] = useState<BriefingRow | null>(initial);
  const [pending, startTransition] = useTransition();

  function regen() {
    startTransition(async () => {
      const result = await restoreContextAction(projectId);
      if (!result.ok) {
        toast.error(`Could not restore context: ${result.error}`);
        return;
      }
      setLatest(result.row);
      toast.success('Context restored');
    });
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
          Where was I?
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={regen}
          disabled={pending}
          aria-label={latest ? 'Regenerate briefing' : 'Generate briefing'}
        >
          <RefreshCcw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
          {latest ? 'Regenerate' : 'Generate'}
        </Button>
      </div>

      {latest ? (
        <>
          <p className="mt-3 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-[var(--color-fg)]">
            {latest.briefing}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
            <Clock className="h-3 w-3" />
            <span>{relativeTime(latest.generatedAt)}</span>
            {latest.modelProvider && latest.modelId ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {latest.modelProvider}/{latest.modelId}
                </span>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm italic text-[var(--color-fg-subtle)]">
          No briefing yet. Generate one to see decisions, blockers, and the smallest next step
          summarised in a few paragraphs.
        </p>
      )}
    </Card>
  );
}
