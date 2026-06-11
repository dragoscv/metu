# Jarvis v3 — intelligence pass (decided 2026-06-12)

Gap analysis: chips/greetings/nudges were static string arrays; no
anticipation loop; flat memory with no consolidation; no daily rhythm;
act skill single-step only.

Decisions (all with Dragos):

1. **Dynamic chips**: LLM-generated suggestions with every skill/turn
   reply (appended cheaply); greetings get context chips.
2. **Anticipation engine**: every ~12 min of active use, a fast-intent
   pass over live context + memory → 0..1 proactive suggestion with
   dynamic chips. Gated by proactivity mode + outcome feedback.
3. **Typed memory + consolidation**: chunks tagged episodic/semantic/
   procedural; nightly Inngest consolidation distills durable insights;
   preferences supersede older ones.
4. **Daily rhythm**: morning briefing (yesterday recap + today's tasks +
   first move) and end-of-day wrap (stored as continuity memory).
5. **Multi-step act**: up to 3 steps, shown upfront, ONE approval,
   verify via a11y re-read after each step, stop+report on mismatch.

## Status

- [x] 1 dynamic chips (skill route emits `\n␞CHIPS:[...]` trailer; client
      parses; greeting chips from activity class)
- [x] 2 anticipation engine (anticipate skill + companion timer)
- [x] 3 typed memory metadata + nightly consolidation function
- [x] 4 morning briefing + end-of-day wrap (companion-side triggers)
- [x] 5 multi-step act plan schema + sequential executor
