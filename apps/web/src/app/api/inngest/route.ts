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
import { githubStatsCron, onGithubRepoStatsSync } from '@/inngest/functions/github-stats-sync';
import {
  onContinuityPrewarm,
  continuityMorningCron,
  continuityMorningDelivery,
  continuityMorningPrewarm,
} from '@/inngest/functions/continuity';
import { conductorProactiveCron } from '@/inngest/functions/conductor-proactive';
import { conductorIdleNudgeCron } from '@/inngest/functions/conductor-idle-nudge';
import { companionAgentAnticipatory } from '@/inngest/functions/companion-anticipatory';
import { recentDigestRefresh } from '@/inngest/functions/recent-digest';
import { dailyDigestEmailCron } from '@/inngest/functions/daily-digest-email';
import { weeklyDigestEmailCron } from '@/inngest/functions/weekly-digest-email';
import { gcsCleanupCron } from '@/inngest/functions/gcs-cleanup';
import { memoryJanitorWeekly } from '@/inngest/functions/memory-janitor';
import { projectDeathDetectionWeekly } from '@/inngest/functions/project-death';

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
    githubStatsCron,
    onGithubRepoStatsSync,
    onContinuityPrewarm,
    continuityMorningCron,
    continuityMorningPrewarm,
    continuityMorningDelivery,
    conductorProactiveCron,
    conductorIdleNudgeCron,
    companionAgentAnticipatory,
    recentDigestRefresh,
    dailyDigestEmailCron,
    weeklyDigestEmailCron,
    gcsCleanupCron,
    memoryJanitorWeekly,
    projectDeathDetectionWeekly,
  ],
});
