---
name: implement-tasks
description: Work through tasks on the project board using implementer and reviewer subagents, one task at a time, with the board as the live record. Use when explicitly asked to execute the board, implement the planned work, or pick up the next task. Assumes the plan is already cut into tasks; does no planning of its own.
disable-model-invocation: true
---

# Implementing board tasks with subagents

You coordinate. You do not write application code. You dispatch subagents, review what they
return, and keep the board honest.

The plan is already cut into tasks. Do not re-plan, re-slice, or add tasks that restate work
already on the board. Your job starts at "what is next" and ends at "it is done and reviewed".

## Set-up

Define the two workers as agent files rather than describing them in each dispatch. A subagent's
model falls back to the main conversation's model when nothing else sets it, and the main
conversation is the most expensive model in the session, so an undefined worker inherits the
coordinator's price tag on every spawn.

```markdown .claude/agents/implementer.md
---
name: implementer
description: Implements one briefed task. Writes tests, makes them pass, commits, reports.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
maxTurns: 40
---

Read the brief you are given. Write tests for what it specifies, make them pass, commit.
Write your report to the path you are given. Return only status, commit range, a one-line
test summary, and concerns. Do not work outside the brief; note anything you find and stop.
```

```markdown .claude/agents/diff-reviewer.md
---
name: diff-reviewer
description: Checks a diff against its brief and writes blocking findings to a file.
tools: Read, Grep, Glob
model: sonnet
maxTurns: 20
---

You are given a diff, the brief it was written from, and a findings path. Write two sections.
Blocking: the brief is not met, a stated error case is untested, or something outside the task
broke. Out of scope: real problems the brief did not cover, for the board. Naming, structure,
and alternative approaches belong in neither. A clean verdict is the normal result. Return the
verdict and the counts only.
```

Read-only tools on the reviewer make its boundary mechanical rather than a rule it has to
remember. `maxTurns` caps a worker that cannot find what it needs and starts reading the
repository to compensate.

Two costs are paid on every spawn regardless of these files: each subagent loads the whole
CLAUDE.md hierarchy and a git status snapshot at startup, and each inherits the session's
extended thinking setting. A large CLAUDE.md multiplied by every dispatch in a slice is worth
measuring before you blame the loop.

## Before the first dispatch

```bash
tasks status list
tasks list --status=in-progress
tasks list --status=priority
```

Statuses are per-project. The column names in this document are the defaults a fresh project
starts with; use whatever `tasks status list` prints. This loop needs a column between "being
worked on" and "finished", so a reviewed task is visibly distinct from a finished one. If the
project has none, add one deliberately: `tasks status add review --after=in-progress`.

Anything already in `in-progress` is either a task you were part-way through or one someone
abandoned. Run `tasks show <id>`, read its notes, and decide whether to resume or restart before
you start anything new.

Read the plan document in the task's refs before working on it. That is the context the task was
written from, and it is shorter than reconstructing it from the code. Read it once per plan, not
once per task.

## Board ownership

Two actors write to this board, so keep the fields separate.

You own `tasks move`. Move to `in-progress` when you dispatch, `review` when the implementer
reports, `done` when the review is clean.

Implementer subagents may run `tasks note` and `tasks update <id> --refs=...` on their own task
only. They move nothing.

Reviewer subagents touch neither the board nor the code. They read a diff and write a findings
file. Everything that happens to that file is your call.

When a subagent finds work outside its task, it notes the finding and you `tasks add` it to
`backlog`. Nobody expands scope silently, and nobody drops a finding either.

Notes are where the value accumulates. On completion, note the commit range, what the reviewer
found, and any decision you made that the plan did not settle. A decision that lives only in
your context is gone at the next compaction. Quote task ids when you mention them to your human
partner, so they can find the card.

## The loop

One implementer at a time. Never dispatch implementers in parallel: tasks that land together
usually touch the same files, and the merge cost outweighs the wall-clock saving.

1. `git rev-parse HEAD`, record it as BASE. `tasks move <id> in-progress`.
2. Write a brief at `.work/<id>-brief.md`. It holds the task's requirements and every exact
   value: identifiers, message strings, error codes, limits, timeouts, paths. Exact values live
   in the brief and nowhere else, so there is one place to correct them. `.work/` is scratch —
   add it to the project's ignore file if it is not there already.
3. Dispatch one implementer, giving it a name you can address later. Its prompt contains four
   things: one line on where this task fits, the brief path, the interfaces from earlier tasks
   that the brief cannot know, and the report path `.work/<id>-report.md`. Nothing else. Never
   paste prior-task history into a dispatch.
4. The implementer writes tests, makes them pass, commits, writes its report, and returns only
   status, commit range, a one-line test summary, and concerns. The report is for whoever picks
   this up cold: what it changed, what it decided that the brief did not settle, what it could
   not resolve. A few hundred words. If the work went as briefed, the report says that and stops.
   It does not dispatch subagents of its own, and it does not review its own work.
5. `tasks move <id> review`. Write the BASE..HEAD diff to `.work/<id>-review.diff` without
   reading it, and dispatch a separate reviewer with three paths: the diff, the brief, and
   `.work/<id>-findings.md` to write to. It returns a verdict and a finding count, nothing more.
   Never read the diff yourself. A whole-branch diff in your context is re-read on every later
   turn for the rest of the session, which costs more than the implementation did.

   The reviewer reports only what blocks: the brief is not met, a stated error case is untested,
   or the change breaks something outside its task. Anything real but outside the card goes in a
   separate section of the findings file for you to put on the backlog. Naming, structure, and
   would-be-nicer are neither, and go nowhere. Tell it so in the dispatch, and tell it that a
   clean verdict is the normal result on a well-briefed task. A reviewer given "check quality"
   will always find something, and every something costs a fix round plus a re-review.
6. Send the findings path to the implementer you already ran, by name, so it resumes with its
   own history instead of starting over. A fresh dispatch re-reads the codebase from nothing and
   costs about what the first attempt did; a resumed one keeps its context and its warmed cache.
   The re-review reads the fix diff and the findings file, not the whole change again. Two
   rounds, not five. If the second review is not clean, the brief is wrong, not the implementer:
   rewrite the brief, reset to BASE, and dispatch once more. If that round is not clean either,
   stop and hand the task to your partner with the findings file. Do not escalate model tier to
   force convergence — it pays the highest per-token rate on the run you already know is going
   badly.
7. `tasks move <id> done`, with a note naming the commit range and the review outcome.

Batch by default, not by exception. Cards that touch the same files, or that are the same edit
repeated across files, go into one brief, one dispatch, and one review of the diff as a unit.
Each dispatch pays a fixed cost to read the code and orient before it writes anything, and three
cards in one brief pay it once. Move each card individually. Split a batch when one card needs an
interface a sibling has not built yet, or when a batch has grown past what one review can hold in
view.

### Where findings go

The findings file has two parts, and they are handled differently. What blocks belongs to the
card and is fixed before it moves to `done`. What the reviewer noticed outside the card is not
a finding at all: `tasks add` it to `backlog`, where the batching rule picks it up with whatever
else lands in the same files.

Do not pool blocking findings into a cleanup card at the end of the slice. A card that missed its
brief is usually one a later card builds on, so deferring the fix means five more cards on a
wrong foundation and a fixer that has to unpick all six. Deferring is cheap for everything the
reviewer is no longer reporting, which is the point of the bar.

Two findings do get pooled:

- **The same fix on more than one card.** One dispatch, one card, the plan's path plus every
  affected card in its refs. Correcting a repeated convention card by card is the case batching
  exists to prevent.
- **Findings from a slice-level review.** If you skipped per-card review because the cards were
  mechanical, the findings arrive pooled already: one brief listing each finding with its file,
  one implementer, one re-review of that diff. The cost is that anything it finds was built on
  by the cards that followed, so do not review at slice level on a slice where an early card
  defines an interface.

Pooling saves cold starts and spends the saving on re-orientation: a pooled fixer reads each area
again, without the brief that card was written from. It wins when the findings sit in the same
files and roughly breaks even when they are scattered.

## Choosing a model

The agent files set the model. Override per invocation only when a card is off the default: the
cheap tier for a single file with a complete brief, where the work is transcription plus tests;
a tier up for anything joining two modules. Reviews stay a tier below the implementation that
produced them, because checking a diff against a brief is a smaller job than writing it. Reserve
the top tier for a review of the whole branch, and only if you skipped per-task reviews. Running
both means paying twice to read the same code.

Turn count costs more than token price. A cheap model that takes three times the turns on
multi-step work is the expensive choice, which is what `maxTurns` in the agent file is there to
catch.

## What the loop costs

Dispatching does not reduce tokens. It moves them out of your context and into a subagent's,
which is what keeps the session alive, but every dispatch pays a cold start: reading the files,
picking up the conventions, running the suite. Spend and context pull in opposite directions and
the rest of this document only defends context, so watch the spend yourself.

Three numbers to keep in view:

- **Agent runs per task.** One implementer and one review is two. Every fix round adds two more.
  Multiply by the cards in the slice before you start, and if the answer is over about twenty,
  batch harder or cut the review on the mechanical cards.
- **Turns inside a run.** A subagent that cannot find what it needs will read half the repo
  looking. That is a brief that was missing a path, and it costs more than the brief would have.
- **Turns in your own session.** Your context is re-read on every turn, so a long session costs
  more per turn the longer it runs. Start a fresh session at each slice boundary, and mid-slice
  if you have run more than a handful of cards. The board and the notes exist so that a cold
  coordinator can pick up where you left off in three commands, which is what makes restarting
  cheap. Carrying eight cards in one session is the most expensive way to run this loop.

## Context hygiene

Everything you paste into a dispatch, and everything a subagent prints back, stays in your
context for the rest of the session and is re-read on every later turn. Hand work over as file
paths. Briefs in, reports out, diffs by path.

Never give a subagent the whole plan or architecture document. Extract what its task needs into
the brief.

Do not fix things yourself because they are small. A controller fix skips review and spends the
context you set this up to protect. Resume the implementer.

Do not read code to judge it, either. Skimming the diff to check one finding pulls the whole
hunk into your context permanently, and you will do it again on the next card. Dispatch the
review, act on the findings file. The only code you read is what a subagent quotes back to you
in a report.

## When to stop

Work through a whole slice without checking in. Progress summaries and "shall I continue" prompts
waste your partner's time.

Stop at the slice boundary: the point where a group of related tasks is complete and the work can
be exercised end to end. Your partner does that by hand, and you cannot.

Stop immediately for anything destructive, any push to a shared branch, and any point where the
plan is broken enough that every path forward is a guess.

## Do not delegate

Some failures look correct in generated code and only appear when the real system runs. Hand
these to your partner rather than a subagent, or dispatch them with a much tighter brief and
expect to debug by hand:

- timing and ordering between concurrent actors, where the bug is the interleaving rather than
  any one wrong line
- state that only exists once a real session, connection, or device is live
- anything that reproduces only against real hardware, a real client, or a third-party service
- anything whose failure mode is silent, where the tests pass and the behaviour is still wrong

This project's own list is more specific than that one, and belongs in `AGENTS.md` rather than
here. Add to it whenever a task burns a fix round on something a subagent was never going to get
right from a brief.

## Rules

1. You write no application code.
2. One implementer at a time.
3. The implementer never reviews itself and never spawns subagents.
4. Every review is a dispatched subagent. You do not read diffs.
5. The reviewer reports blocking findings only. Two fix rounds, then the brief gets rewritten.
6. Resume the implementer for a fix round. A fresh dispatch pays for the codebase twice.
7. Batch cards that share files into one dispatch.
8. Start a fresh session at the slice boundary. The board is the handover.
9. Exact values live in the brief, not in the dispatch prompt.
10. You own `move`; implementers own `note` and `refs` on their own card.
11. Look up the project's columns with `tasks status list`; the names used above are defaults, not
   the schema.
12. Never edit `.tasks/tasks.jsonl` by hand. Use the `tasks` CLI.
13. Never write a task checklist into the plan. The plan is the reasoning, the board is the state.
14. A decision you make on your partner's behalf goes in a `tasks note`, with what it costs if it
   is wrong.