import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Page, PageHeader, PageSection } from '@metu/ui';
import { listPersonas } from '@/app/actions/personas';
import {
  getPrivacyBadgeState,
  getVoiceCapStateAction,
  listActivations,
  listDeviceAcl,
  listRecentDeviceToolCalls,
  listRecentSensory,
} from '@/app/actions/presence';
import { PersonaManager, type PersonaRow } from '@/components/persona-manager';
import { PersonaImportExport } from '@/components/persona-import-export';
import { ActivationsGrid } from '@/components/activations-grid';
import { DeviceAclEditor } from '@/components/presence-acl-editor';
import { PresenceAuditLog } from '@/components/presence-audit-log';
import { SensoryRingViewer } from '@/components/sensory-ring-viewer';
import { PrivacyBadge } from '@/components/privacy-badge';
import { VoiceBudgetMeter } from '@/components/voice-budget-meter';

/**
 * Settings → Presence.
 *
 * Slice 2 shipped the persona library; slice 10 layers on:
 *   1. Active personas grid (live activations across devices)
 *   2. Personas library (existing manager)
 *   3. Device ACL editor (per-tool autonomy mode)
 *   4. Audit log (last 50 device.* tool calls)
 *   5. Sensory ring viewer + clear-now action
 *
 * The privacy badge in the header is the on-screen "observing" indicator
 * promised by D16.
 */
export default async function PresencePage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [personas, activations, acl, audit, sensory, badgeState, voiceCap] = await Promise.all([
    listPersonas(),
    listActivations(),
    listDeviceAcl(),
    listRecentDeviceToolCalls(50),
    listRecentSensory(30),
    getPrivacyBadgeState(),
    getVoiceCapStateAction(),
  ]);

  const initial: PersonaRow[] = personas.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    systemPrompt: p.systemPrompt,
    voiceProvider: p.voiceProvider,
    voiceId: p.voiceId,
    sttProvider: p.sttProvider,
    avatarKind: p.avatarKind,
    defaultForm: p.defaultForm,
    hotkey: p.hotkey,
    wakeWord: p.wakeWord,
    proactivity: p.proactivity,
    language: p.language,
    costTier: p.costTier,
    mode: p.mode,
    eagerness: p.eagerness,
    isBuiltIn: p.isBuiltIn,
  }));
  const personaName: Record<string, string> = Object.fromEntries(
    personas.map((p) => [p.id, p.name]),
  );

  return (
    <Page>
      <PageHeader
        title="Presence"
        description="Your AI characters and how they appear across devices"
      />

      <div>
        <PrivacyBadge initial={badgeState} refetch={getPrivacyBadgeState} />
      </div>

      <div>
        <VoiceBudgetMeter initial={voiceCap} refetch={getVoiceCapStateAction} />
      </div>

      <PageSection
        title="Active personas"
        description="Personas currently bound to a device. Deactivating ends the voice loop on that surface."
      >
        <ActivationsGrid initial={activations} personaName={personaName} />
      </PageSection>

      <PageSection
        title="Personas library"
        description="Built-in characters live alongside your custom ones. Built-ins can be edited but not deleted."
      >
        <PersonaManager initial={initial} />
      </PageSection>

      <PageSection
        title="Import / export"
        description="Share personas across workspaces or back them up. Built-ins are always re-seeded automatically, so you only need to export your customs."
      >
        <PersonaImportExport />
      </PageSection>

      <PageSection
        title="Device tool ACL"
        description="Default for every write tool is Ask. Lower it only for tools you trust to run unattended."
      >
        <DeviceAclEditor initial={acl} />
      </PageSection>

      <PageSection
        title="Sensory ring"
        description="Recent on-device captures (screenshots, transcripts, focus events) summarised here."
      >
        <SensoryRingViewer rows={sensory} />
      </PageSection>

      <PageSection
        title="Audit log"
        description="Last 50 device.* tool calls. Useful when debugging an Ask prompt or auditing autopilot."
      >
        <PresenceAuditLog rows={audit} />
      </PageSection>
    </Page>
  );
}
