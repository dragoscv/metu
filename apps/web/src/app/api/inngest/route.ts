import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { onCaptureCreated } from '@/inngest/functions/capture';
import {
  nightlyProjectPulse,
  onFocusRecompute,
  onProjectMomentum,
} from '@/inngest/functions/focus';
import {
  onConductorApproved,
  onConductorObserve,
  onConductorTick,
} from '@/inngest/functions/conductor';
import { onConductorNotify } from '@/inngest/functions/notify';

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
    onConductorNotify,
  ],
});
