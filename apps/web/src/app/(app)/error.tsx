'use client';

import { useEffect } from 'react';
import { ErrorReport } from '@/components/error/error-report';

export default function AppGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] route error', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <ErrorReport context={{ kind: 'render', error }} reset={reset} />
    </div>
  );
}
