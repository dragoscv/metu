import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardTitle } from '@metu/ui';
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
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardTitle>Pair a device</CardTitle>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Enter the code shown on your device or companion app to authorize it for this workspace.
        </p>
        <div className="mt-4">
          <DeviceVerifyForm initialCode={sp.code ?? ''} />
        </div>
      </Card>
    </div>
  );
}
