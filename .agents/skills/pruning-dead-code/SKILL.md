---
name: pruning-dead-code
description: Use when the user asks to clean up, tidy, prune, remove unused, dead, duplicate, irrelevant, or leftover code, or strip leftovers after a feature or bugfix; when a TypeScript-only grep looks like enough proof to delete; or when asked to skip a findings list and just delete.
---

# Pruning Dead Code

Prune dead wood. Leave living branches. **Prove-alive** every candidate, report, then wait. File edits happen only after the user approves a **Dead** item.

**Violating the letter of these rules is violating the spirit of the rules.**

## Out of scope

Architecture deepening, rename-for-taste, rewrite of working logic, format-only churn. Those are code-review or improve-codebase-architecture.

## Iron law

Do not delete, inline, or tidy away any code until both are true:

1. That item **failed prove-alive** with cited evidence, and
2. The user **approved that item** after the report below.

Doubt = **Keep**. Uncertain = **Keep**, listed, not proposed for delete.

The user said "don't write a report", "just delete", "I already grepped", "be a senior and ship"? Still report. Still wait. Urgency is not prove-alive.

## 1. Pin the change set

Git diff vs a named fixed point (`main`, merge-base, session files). If they did not name one, ask. Empty diff → stop.

Completion: a file list. Do not scan the rest of the repo.

## 2. Inventory

In that set **plus callers only**: unused imports/exports, dead functions/components, commented-out blocks, leftover debug, unused CSS/types, leftover test helpers, docs that describe removed behavior, duplicate copies.

Completion: every candidate is named.

## 3. Prove-alive

For **each** candidate, search **all** of:

- TS/TSX identifiers and imports
- Tests
- Markdown (`AGENTS.md`, specs, `CONTEXT.md`)
- Prisma schema / seeds
- String literals, `import()`, routes, env keys

A TypeScript-only grep is not proof. The user's grep is not your prove-alive.

Do not mark **Dead** on searches you did not run in this session. Missing a search → run it, or class **Uncertain**. Never invent a "no hits" citation.

| Class | Rule |
|-------|------|
| **Dead** | Every search above found no live reference |
| **Keep** | Any live reference — cite it |
| **Uncertain** | Dynamic, string, reflection, or docs-only — do not propose delete |
| Duplicate | **Dead** only if one copy has zero callers after the other stays. Merging two live copies is a refactor → **Uncertain** |

Never propose delete for: auth, guards, `proxy.ts`, RLS-adjacent code; Prisma migrations and leftover identifiers named in `AGENTS.md`; known-gap adapters (`FakeGmailAdapter`, in-memory queues, fallbacks); public routes, webhooks, health fields; anything in tests, specs, or seeds; `/payroll` placeholder; "might be unused later."

Completion: every candidate has a class and a citation.

## 4. Report — this turn's only output

Search tool calls are allowed. File edits are not. Required shape:

```
## Dead (needs your yes)
| ID | Item | File | Evidence it is unused | Proposed action |
## Uncertain (left alone)
| Item | Why it was not proposed |
## Keep (looked unused, had a live reference)
| Item | Live reference |
```

Then: "Approve all Dead, pick IDs, or cancel."

Completion: the user has this report. Nothing was edited.

## 5. Apply only after yes

Approved **Dead** IDs only. Then lint, typecheck, and tests for the touched area. Re-prove nothing essential vanished.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Don't write a report / just delete / ship" | The report is the work. Edits after yes. |
| "I already grepped" | You still run full prove-alive. |
| "No TS imports" | Not proof. Tests, markdown, strings, Prisma still required. |
| "I know there are no tests/docs" | You searched this session, or it is **Uncertain**. |
| "console.debug is obvious" | It goes in **Dead**. Wait. |
| "I'll mention it after" | That is editing before yes. |
| "Be a senior" | Senior means prove-alive, not silent delete. |
| "Widen the scan, the repo should be clean" | Stay in the pinned set. |
| "FakeGmailAdapter / payroll look unused" | Known gaps. **Keep**. |

## Red flags — STOP, report, wait

- About to edit a file before the user answered the report
- About to treat `rg` on `*.ts` as enough
- About to write "no hits in tests/docs" without having searched them
- About to touch files outside the pinned set
- "They said don't bother me with a list"
