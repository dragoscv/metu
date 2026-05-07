import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, Page, PageHeader } from '@metu/ui';
import { DeviceVerifyForm } from '@/components/device-verify-form';

export default async function VerifyDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const session = await auth();
  if (!session) {
    const sp = await searchParams;
    const cb = sp.code ? `/devices/verify?code=${encodeURIComponent(sp.code)}` : '/devices/verify';
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(cb)}`);
  }
  const sp = await searchParams;

  return (
    <Page className="mx-auto max-w-md">
      <PageHeader
        size="sm"
        back={{ href: '/devices', label: 'Devices' }}
        title="Pair a device"
        description="Enter the code shown on your device or companion app to authorize it for this workspace."
      />
      <Card>
        <DeviceVerifyForm initialCode={sp.code ?? ''} />
      </Card>
    </Page>
  );
}
