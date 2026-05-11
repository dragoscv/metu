'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@metu/ui';
import { Wand2 } from 'lucide-react';
import { seedDemoDataAction } from '@/app/actions/seed-demo';

export function SeedDemoButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await seedDemoDataAction();
          if (result.ok) toast.success('Sample project created — check Projects.');
          else toast.error(result.error);
        })
      }
    >
      <Wand2 className="mr-1.5 h-3.5 w-3.5" />
      {pending ? 'Seeding…' : 'Or, just give me a sample project'}
    </Button>
  );
}
