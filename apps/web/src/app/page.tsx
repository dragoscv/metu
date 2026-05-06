import Link from 'next/link';
import { auth } from '@metu/auth';
import { Button } from '@metu/ui';
import { ArrowRight, Brain, Compass, Sparkles, Zap } from 'lucide-react';

export default async function Landing() {
  const session = await auth();

  return (
    <main className="relative isolate min-h-screen overflow-hidden">
      {/* Ambient gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 transform-gpu blur-3xl"
      >
        <div
          className="relative left-1/2 aspect-[1155/678] w-[72rem] -translate-x-1/2 rotate-[20deg] opacity-30"
          style={{
            background: 'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent) 100%)',
            clipPath:
              'polygon(74% 44%, 100% 61%, 97% 26%, 85% 0%, 80% 2%, 72% 32%, 60% 62%, 52% 68%, 47% 58%, 45% 34%, 27% 76%, 0% 64%, 17% 100%, 27% 76%, 76% 97%, 74% 44%)',
          }}
        />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-brand)] text-[var(--color-brand-fg)]">
            m
          </span>
          metu
        </Link>
        <div className="flex items-center gap-3">
          {session ? (
            <Link href="/dashboard">
              <Button size="sm">Open dashboard</Button>
            </Link>
          ) : (
            <Link href="/sign-in">
              <Button size="sm">Sign in</Button>
            </Link>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-24 pt-20 text-center">
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs text-[var(--color-fg-muted)]">
          <Sparkles className="h-3 w-3" /> External RAM for AI-native founders
        </p>
        <h1 className="text-balance text-5xl font-semibold tracking-tight md:text-7xl">
          Not another assistant.
          <br />
          <span className="bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent)] bg-clip-text text-transparent">
            A second brain that decides.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-[var(--color-fg-muted)]">
          metu externalizes the executive function you keep running out of — ruthless
          prioritization, context continuity, and ambient memory across every project, device, and
          conversation.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link href={session ? '/dashboard' : '/sign-in'}>
            <Button size="lg">
              {session ? 'Continue' : 'Sign in with Google'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <a href="https://github.com/yourname/metu" target="_blank" rel="noreferrer">
            <Button size="lg" variant="outline">
              View source
            </Button>
          </a>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 md:grid-cols-3">
        {[
          {
            icon: Compass,
            title: 'Focus Engine',
            desc: 'Tells you what NOT to do. Reduces decision space ruthlessly.',
          },
          {
            icon: Brain,
            title: 'Memory that lasts',
            desc: 'Episodic + semantic recall over every commit, capture, decision.',
          },
          {
            icon: Zap,
            title: 'BYOK AI mesh',
            desc: 'Anthropic, OpenAI, Azure, Gemini, Copilot — pick per-task.',
          },
        ].map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-6"
          >
            <f.icon className="h-5 w-5 text-[var(--color-brand)]" />
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
