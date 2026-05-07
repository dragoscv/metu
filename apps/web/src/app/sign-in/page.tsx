import { redirect } from 'next/navigation';
import { auth } from '@metu/auth';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  if (session?.user) redirect(params.callbackUrl ?? '/dashboard');
  return <SignInForm />;
}
