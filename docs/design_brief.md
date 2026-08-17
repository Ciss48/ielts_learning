# Claude Design brief — IELTS Daily

Use this any time before Phase 01 finishes. Export the result into a `design/`
folder in the project root — Phase 01's task file tells Claude Code to use it as a
visual reference if present (and to proceed without it if absent, so design never
blocks development).

---

## Prompt to paste into Claude Design

```
Design a personal IELTS study web app called "IELTS Daily" — a calm, focused,
single-user daily study tool. Desktop-first but comfortable on mobile. Minimal,
quiet interface: the user should open it and start studying with zero decisions.
Style: clean typography, generous whitespace, one accent color (deep teal), subtle
skill badges (Reading = blue, Listening = purple, Writing = amber, Speaking = coral,
Vocab = teal, Mixed = gray). Light and dark mode.

Design 3 screens:

1. TODAY (home) — the heart of the app. One large card for today's unit: skill
badge, block label (e.g. "Foundation · Week 1"), unit title, estimated minutes, an
ELSA task line with a checkbox, and a single primary button "Start session". Below
the card: a small GitHub-style activity heatmap strip (last 12 weeks) and a streak
counter. Nothing else on this screen.

2. SESSION PLAYER — a focused study view with a slim step indicator at the top
(Warm-up → Strategy → Practice → Review → Vocab), where future steps can appear
disabled. Main area renders a markdown lesson comfortably (max ~68ch line width).
Sticky footer bar with a timer chip (mm:ss, used during Practice) and a primary
button ("Continue" / "Mark complete"). Include a variant of the Practice step
showing a reading passage on the left and numbered answer inputs on the right.

3. ROADMAP — a vertical timeline of units grouped by block (Foundation, Diagnostic,
Skill cycles, Mock block, Taper). Each row: seq number, skill badge, title, status:
completed (check), current (highlighted, clickable), locked (dimmed). A compact
progress summary at the top: "Unit 7 of 144 · Week 2 of 24".
```

---

## Handoff notes

- Ask Claude Design for a code export (React + Tailwind). Put it in `design/`.
- Don't fight for pixel perfection here — Phase 01 treats it as a reference for
  spacing, colors, and layout, not a component library to import wholesale.
- The Practice-step variant (screen 2) is Phase 02's target UI; having it designed
  early keeps the player's layout stable when the test player lands.
