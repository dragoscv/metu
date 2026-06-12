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
import { onGithubRepoWebhookEnsure } from '@/inngest/functions/github-webhook-ensure';
import {
  githubDigestDailyCron,
  onGithubDigestDaily,
} from '@/inngest/functions/github-digest-daily';
import {
  projectAnomalyScanCron,
  onProjectAnomalyScan,
} from '@/inngest/functions/project-anomaly-scan';
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
import { memoryConsolidation } from '@/inngest/functions/memory-consolidation';
import { dailyDigestEmailCron } from '@/inngest/functions/daily-digest-email';
import { weeklyDigestEmailCron } from '@/inngest/functions/weekly-digest-email';
import { gcsCleanupCron } from '@/inngest/functions/gcs-cleanup';
import { memoryJanitorWeekly } from '@/inngest/functions/memory-janitor';
import { projectDeathDetectionWeekly } from '@/inngest/functions/project-death';
import { nightlyHousekeepingCron } from '@/inngest/functions/nightly-housekeeping';
import { pushReceiptPollCron } from '@/inngest/functions/push-receipt-poll';
import { slackSyncCron, onSlackSync } from '@/inngest/functions/slack-sync';
import { gcalSyncCron, onGcalSync } from '@/inngest/functions/gcal-sync';
import { linearSyncCron, onLinearSync } from '@/inngest/functions/linear-sync';
import { redditSyncCron, onRedditSync } from '@/inngest/functions/reddit-sync';
import { twitterSyncCron, onTwitterSync } from '@/inngest/functions/twitter-sync';
import { youtubeSyncCron, onYoutubeSync } from '@/inngest/functions/youtube-sync';
import { spotifySyncCron, onSpotifySync } from '@/inngest/functions/spotify-sync';
import { instagramSyncCron, onInstagramSync } from '@/inngest/functions/instagram-sync';
import { notionSyncCron, onNotionSync } from '@/inngest/functions/notion-sync';
import { stripeSyncCron, onStripeSync } from '@/inngest/functions/stripe-sync';
import { vercelSyncCron, onVercelSync } from '@/inngest/functions/vercel-sync';
import { onSyncFailed } from '@/inngest/functions/sync-failure-recorder';
import { onDeviceEventReact } from '@/inngest/functions/device-event-reactor';
import { integrationStaleDetector } from '@/inngest/functions/integration-stale-detector';
import { hubDlqReplay } from '@/inngest/functions/hub-dlq-replay';
import { onCronFailed } from '@/inngest/functions/cron-failure-alert';
import { reviewNarrativePrewarm } from '@/inngest/functions/review-narrative-prewarm';

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
    onGithubRepoWebhookEnsure,
    githubDigestDailyCron,
    onGithubDigestDaily,
    projectAnomalyScanCron,
    onProjectAnomalyScan,
    onContinuityPrewarm,
    continuityMorningCron,
    continuityMorningPrewarm,
    continuityMorningDelivery,
    conductorProactiveCron,
    conductorIdleNudgeCron,
    companionAgentAnticipatory,
    recentDigestRefresh,
    memoryConsolidation,
    dailyDigestEmailCron,
    weeklyDigestEmailCron,
    gcsCleanupCron,
    memoryJanitorWeekly,
    hubDlqReplay,
    onCronFailed,
    reviewNarrativePrewarm,
    projectDeathDetectionWeekly,
    nightlyHousekeepingCron,
    pushReceiptPollCron,
    slackSyncCron,
    onSlackSync,
    gcalSyncCron,
    onGcalSync,
    linearSyncCron,
    onLinearSync,
    redditSyncCron,
    onRedditSync,
    twitterSyncCron,
    onTwitterSync,
    youtubeSyncCron,
    onYoutubeSync,
    spotifySyncCron,
    onSpotifySync,
    instagramSyncCron,
    onInstagramSync,
    notionSyncCron,
    onNotionSync,
    stripeSyncCron,
    onStripeSync,
    vercelSyncCron,
    onVercelSync,
    onSyncFailed,
    onDeviceEventReact,
    integrationStaleDetector,
  ],
});
