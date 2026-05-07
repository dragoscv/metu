'use client';
/**
 * Profile Wizard — animated single-question flow.
 *
 * Always-on entry point: user can re-open this page at any time and the LLM
 * generates a fresh contextual question that hasn't been asked yet.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  PageSection,
  StatusDot,
  Textarea,
} from '@metu/ui';
import { Check, Sparkles, Trash2, X as XIcon, RefreshCw, ArrowRight } from 'lucide-react';
import {
  type ProfileFact,
  type ProfileQuestion,
  deleteProfileFactAction,
  generateNextProfileQuestionAction,
  skipProfileQuestionAction,
  submitProfileAnswerAction,
} from '@/app/actions/profile-wizard';

interface Props {
  initialFacts: ProfileFact[];
  initialFactCount: number;
  userName: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;

const STORAGE_KEY = 'metu:profile-wizard:current';

interface PersistedState {
  question: ProfileQuestion;
  selected: string[];
  freeform: string;
  askedTopics: string[];
}

function loadPersisted(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed?.question?.question || !parsed.question.topic) return null;
    return {
      question: parsed.question as ProfileQuestion,
      selected: Array.isArray(parsed.selected) ? parsed.selected : [],
      freeform: typeof parsed.freeform === 'string' ? parsed.freeform : '',
      askedTopics: Array.isArray(parsed.askedTopics) ? parsed.askedTopics : [],
    };
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedState | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!state) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // storage disabled — silent
  }
}

export function ProfileWizard({ initialFacts, initialFactCount, userName }: Props) {
  const [facts, setFacts] = useState<ProfileFact[]>(initialFacts);
  const [factCount, setFactCount] = useState(initialFactCount);
  const [question, setQuestion] = useState<ProfileQuestion | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askedTopics, setAskedTopics] = useState<string[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [freeform, setFreeform] = useState('');
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  // Disable inputs whenever we're saving an answer OR fetching the next
  // question. Without this the user can keep tapping chips between submit
  // and the next question rendering, which feels broken.
  const busy = submitting || loadingQuestion;

  const fetchNext = useCallback(async () => {
    setLoadingQuestion(true);
    setError(null);
    setQuestion(null);
    setSelected([]);
    setFreeform('');
    savePersisted(null);
    const res = await generateNextProfileQuestionAction({ recentTopics: askedTopics });
    if (!res.ok) {
      setError(res.error);
      setQuestion(null);
      setLoadingQuestion(false);
      return;
    }
    setQuestion(res.question);
    setAskedTopics((prev) => {
      const next = [...prev, res.question.topic].slice(-12);
      return next;
    });
    setLoadingQuestion(false);
  }, [askedTopics]);

  // On mount: restore the last unanswered question from localStorage so the
  // user can refresh / come back later without losing context. Only fetch a
  // new one when storage is empty.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const restored = loadPersisted();
    if (restored) {
      setQuestion(restored.question);
      setSelected(restored.selected);
      setFreeform(restored.freeform);
      setAskedTopics(restored.askedTopics);
      return;
    }
    void fetchNext();
  }, [fetchNext]);

  // Persist whenever the in-flight question or its draft answer changes.
  useEffect(() => {
    if (!question) return;
    savePersisted({ question, selected, freeform, askedTopics });
  }, [question, selected, freeform, askedTopics]);

  const toggleChoice = (value: string) => {
    if (!question || busy) return;
    if (question.allowMultiSelect) {
      setSelected((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      );
    } else {
      setSelected((prev) => (prev[0] === value ? [] : [value]));
    }
  };

  const canSubmit = !!question && !busy && (selected.length > 0 || freeform.trim().length > 0);

  const handleSubmit = async () => {
    if (!question || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    const snapshot = {
      topic: question.topic,
      qText: question.question,
      selected: [...selected],
      freeform: freeform.trim(),
    };
    const res = await submitProfileAnswerAction({
      topic: question.topic,
      question: question.question,
      kind: question.kind,
      selectedChoices: selected,
      freeformAnswer: freeform,
    });
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    // Optimistic local insert so the list grows immediately.
    const justAnswered: ProfileFact = {
      id: res.factId,
      topic: snapshot.topic,
      content: `[profile:${snapshot.topic}] Q: ${snapshot.qText}\nA: ${[
        snapshot.selected.join('; '),
        snapshot.freeform,
      ]
        .filter(Boolean)
        .join(' — ')}`,
      createdAt: new Date().toISOString(),
    };
    setFacts((prev) => [justAnswered, ...prev].slice(0, 40));
    setFactCount((c) => c + 1);
    // Flip to loading state immediately — fetchNext clears question + resets
    // selection so the previous card disappears as soon as we leave submit.
    startTransition(() => {
      void fetchNext().finally(() => setSubmitting(false));
    });
  };

  const handleSkip = async () => {
    if (!question || busy) return;
    void skipProfileQuestionAction({
      topic: question.topic,
      question: question.question,
      reason: '',
    });
    void fetchNext();
  };

  const handleDeleteFact = (id: string) => {
    setFacts((prev) => prev.filter((f) => f.id !== id));
    setFactCount((c) => Math.max(0, c - 1));
    void deleteProfileFactAction({ id });
  };

  return (
    <div className="space-y-6">
      <ProgressCard
        factCount={factCount}
        userName={userName}
        onRefresh={() => void fetchNext()}
        refreshing={busy}
      />

      <PageSection
        title="Your next question"
        description="One thoughtful question at a time. Skip anything that doesn't fit."
      >
        <div className="relative min-h-[300px]">
          <AnimatePresence mode="wait">
            {loadingQuestion && (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <Card variant="outline" className="space-y-4">
                  <div className="flex items-center gap-3">
                    <StatusDot state="brand" pulse size="md" />
                    <span className="text-sm font-medium text-[var(--color-fg)]">
                      {submitting ? 'Saving your answer…' : 'Thinking of a good question for you…'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--color-bg-elevated)]" />
                    <div className="h-3.5 w-1/2 animate-pulse rounded bg-[var(--color-bg-elevated)]" />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {[140, 110, 160, 90].map((w, i) => (
                      <div
                        key={i}
                        className="h-7 animate-pulse rounded-full bg-[var(--color-bg-elevated)]"
                        style={{ width: `${w}px` }}
                      />
                    ))}
                  </div>
                </Card>
              </motion.div>
            )}

            {!loadingQuestion && error && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Card variant="outline" className="space-y-3">
                  <p className="text-sm text-[var(--color-danger,#dc2626)]">{error}</p>
                  <Button variant="outline" onClick={() => void fetchNext()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Try again
                  </Button>
                </Card>
              </motion.div>
            )}

            {!loadingQuestion && !error && question && (
              <motion.div
                key={`q-${question.question}`}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                <Card className="space-y-5">
                  <div className="flex items-center gap-2">
                    <Badge variant="brand" size="sm">
                      <Sparkles className="mr-1 h-3 w-3" />
                      {question.topic}
                    </Badge>
                    {question.allowMultiSelect &&
                    question.choices &&
                    question.choices.length > 0 ? (
                      <Badge variant="neutral" size="sm">
                        Pick any that fit
                      </Badge>
                    ) : null}
                  </div>

                  <p className="text-xl font-medium leading-snug text-[var(--color-fg)]">
                    {question.question}
                  </p>

                  {question.choices && question.choices.length > 0 ? (
                    <motion.div
                      initial="hidden"
                      animate="show"
                      variants={{
                        hidden: {},
                        show: { transition: { staggerChildren: 0.04 } },
                      }}
                      className="flex flex-wrap gap-2"
                    >
                      {question.choices.map((c) => {
                        const active = selected.includes(c.value);
                        return (
                          <motion.button
                            key={c.value}
                            type="button"
                            onClick={() => toggleChoice(c.value)}
                            disabled={busy}
                            variants={{
                              hidden: { opacity: 0, y: 6 },
                              show: { opacity: 1, y: 0 },
                            }}
                            whileTap={{ scale: busy ? 1 : 0.97 }}
                            className={[
                              'group rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                              active
                                ? 'bg-[var(--color-brand)]/15 border-[var(--color-brand)] text-[var(--color-fg)]'
                                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                              busy &&
                                'cursor-not-allowed opacity-60 hover:border-[var(--color-border)] hover:text-[var(--color-fg-muted)]',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {active ? (
                              <Check className="-mt-0.5 mr-1 inline-block h-3.5 w-3.5" />
                            ) : null}
                            {c.label}
                          </motion.button>
                        );
                      })}
                    </motion.div>
                  ) : null}

                  {(question.kind === 'free_text' || question.kind === 'multi_with_freeform') && (
                    <Textarea
                      placeholder={
                        question.kind === 'multi_with_freeform'
                          ? 'Or write your own answer…'
                          : 'Your answer…'
                      }
                      value={freeform}
                      onChange={(e) => setFreeform(e.target.value)}
                      rows={4}
                      readOnly={busy}
                      autoFocus={question.kind === 'free_text'}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
                          e.preventDefault();
                          void handleSubmit();
                        }
                      }}
                    />
                  )}

                  <div className="flex items-center justify-between gap-2 pt-2">
                    <Button variant="ghost" onClick={handleSkip} disabled={busy}>
                      <XIcon className="mr-2 h-4 w-4" />
                      Skip
                    </Button>
                    <div className="flex items-center gap-2">
                      <span className="hidden text-xs text-[var(--color-fg-subtle)] sm:inline">
                        ⌘ + Enter
                      </span>
                      <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
                        {submitting ? 'Saving…' : busy ? 'Loading…' : 'Save & next'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PageSection>

      <PageSection
        title="What I've learned about you"
        description="Pruning a fact removes it from my memory."
      >
        {facts.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="Nothing yet"
            description="Answer a question above to start building your profile."
          />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {facts.map((f) => (
                <motion.li
                  key={f.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <Card variant="outline" className="group h-full p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant="neutral" size="xs">
                        {f.topic}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => handleDeleteFact(f.id)}
                        title="Forget this fact"
                        className="text-[var(--color-fg-subtle)] opacity-0 transition-opacity hover:text-[var(--color-fg)] group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-fg-muted)]">
                      {prettifyFact(f.content)}
                    </p>
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </PageSection>
    </div>
  );
}

function ProgressCard({
  factCount,
  userName,
  onRefresh,
  refreshing,
}: {
  factCount: number;
  userName: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const milestones = [3, 10, 25, 50, 100];
  const next = milestones.find((m) => m > factCount) ?? null;
  const prev = [...milestones].reverse().find((m) => m <= factCount) ?? 0;
  const pct = next ? Math.min(100, Math.round(((factCount - prev) / (next - prev)) * 100)) : 100;

  return (
    <Card variant="glass" className="overflow-hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="!text-xs uppercase tracking-wide">
            About {userName ?? 'you'}
          </CardTitle>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {factCount} {factCount === 1 ? 'fact' : 'facts'} learned
          </p>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {next
              ? `${next - factCount} more until the next milestone (${next}).`
              : 'You are a profile master. Keep going if you like.'}
          </p>
        </div>
        <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          New question
        </Button>
      </div>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
        <motion.div
          className="h-full rounded-full bg-[var(--color-brand)]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: EASE }}
        />
      </div>
    </Card>
  );
}

/**
 * Memory chunks are stored as `[profile:topic] Q: ... \n A: ...`. Render only
 * the answer line for the fact list — the topic is shown as a chip already.
 */
function prettifyFact(content: string): string {
  const idxA = content.indexOf('\nA: ');
  if (idxA >= 0) return content.slice(idxA + 4);
  return content;
}
