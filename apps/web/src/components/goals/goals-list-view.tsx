'use client';
import { useState } from 'react';
import { GoalRow, type GoalListItem } from './goal-row';
import { GoalsToolbar } from './goals-toolbar';

export function GoalsListView({
  goals,
  facets,
}: {
  goals: GoalListItem[];
  facets: {
    status: { value: string; count: number }[];
    drift: { value: string; count: number }[];
  };
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clear = () => setSelected(new Set());

  // Group: top-level first, then their sub-goals interleaved.
  const byParent = new Map<string | null, GoalListItem[]>();
  for (const g of goals) {
    const k = g.parentGoalId ?? null;
    const arr = byParent.get(k) ?? [];
    arr.push(g);
    byParent.set(k, arr);
  }
  const topLevel = byParent.get(null) ?? [];
  // sub-goals whose parent isn't in this filtered set should still show
  const orphanedSubs = goals.filter(
    (g) => g.parentGoalId && !goals.some((p) => p.id === g.parentGoalId),
  );

  const ordered: { goal: GoalListItem; isSub: boolean }[] = [];
  for (const g of topLevel) {
    ordered.push({ goal: g, isSub: false });
    const subs = byParent.get(g.id) ?? [];
    for (const s of subs) ordered.push({ goal: s, isSub: true });
  }
  for (const o of orphanedSubs) ordered.push({ goal: o, isSub: false });

  return (
    <div className="space-y-3">
      <GoalsToolbar
        facets={facets}
        resultCount={goals.length}
        selectedIds={Array.from(selected)}
        onClearSelection={clear}
      />
      <ul className="space-y-2">
        {ordered.map(({ goal, isSub }, i) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            index={i}
            selected={selected.has(goal.id)}
            onToggleSelect={toggle}
            isSubGoal={isSub}
          />
        ))}
      </ul>
    </div>
  );
}
