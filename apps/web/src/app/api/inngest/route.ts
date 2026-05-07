import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { onCaptureCreated } from '@/inngest/functions/capture';
import {
  nightlyProjectPulse,
  onFocusRecompute,
  onProjectMomentum,
} from '@/inngest/functions/focus';
import {
  conductorBackstop,
  onConductorApproved,
  onConductorObserve,
  onConductorTick,
} from '@/inngest/functions/conductor';
import { onConductorNotify } from '@/inngest/functions/notify';
import { goalsMorningCheckin, goalsWeeklyReview, onGoalsReview } from '@/inngest/functions/goals';
import { onGithubRepoLinked } from '@/inngest/functions/github-repo-indexing';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    onCaptureCreated,
    onFocusRecompute,
    onProjectMomentum,
    nightlyProjectPulse,
    onConductorObserve,
    onConductorTick,
    onConductorApproved,
    conductorBackstop,
    onConductorNotify,
    goalsMorningCheckin,
    goalsWeeklyReview,
    onGoalsReview,
    onGithubRepoLinked,
  ],
});
