---
description: Audit the vault for orphans, contradictions, and stale notes
argument-hint: "[optional: scope, e.g. '01 - Projects/' to limit]"
---

# /lint — Vault audit

Scope: **$ARGUMENTS** (default: whole vault)

Find the rot. Surface it. Don't auto-fix anything invasive — Charles decides.

## Checks to run

### 1. Orphans (no inbound links)
Every note should be reachable from at least one other note OR from a root doc (`MASTER-PATH-TO-SUCCESS.md`, an `INDEX.md`, or a project README). Report notes with zero inbound `[[wikilinks]]`, except:
- Notes in `00 - Inbox/` (they're expected to be orphans)
- Notes in `04 - Archive/` (already retired)

### 2. Broken wikilinks
Any `[[target]]` that doesn't resolve to an existing note. Report: source file, broken link, best-guess replacement (fuzzy match on existing notes).

### 3. Stale notes
- `01 - Projects/*/` files not modified in **14+ days** (project is drifting)
- `00 - Inbox/` files older than **7 days** (not filed)
- `03 - Resources/` files tagged `#draft` older than **30 days** (never finished)

### 4. Contradictions
Grep for contradictory claims on the same topic. Specifically:
- Different numeric values for the same metric
- Direct negations (`X is true` vs `X is false`) across notes
- Process docs that disagree on the order of steps
List each with both source notes linked. Don't resolve — surface.

### 5. Front-matter drift
Notes missing required front matter (`date`, `type`, `status`), or with values outside the allowed set.

### 6. Filename hygiene
- Inconsistent case (should be kebab-case for docs, Title Case for topics/people)
- Duplicates that differ only by case or whitespace
- Files with `Untitled`, `New note`, or a date-only name (unfiled captures)

### 7. PARA violations
- Projects folder contains something with no `status: active` and no recent edits → probably belongs in `04 - Archive/`
- Resources folder contains something with a deadline / owner → probably a Project
- Areas folder with a finite deliverable → probably a Project

### 8. `_output/` sanity
`_output/` should only contain regenerable artifacts. Anything in `_output/` that looks like canonical content (no matching source elsewhere in the vault) → flag, Charles should move it.

## Emit

A single audit report, emitted to the chat AND saved to `_output/reports/lint-$(date +%Y-%m-%d).md`. Structure:

```markdown
# Vault Lint — YYYY-MM-DD

**Scope:** <folder or "whole vault">
**Files scanned:** <N>

## 🟥 Critical (action this week)
- ...

## 🟧 Stale (review soon)
- ...

## 🟨 Hygiene (whenever)
- ...

## 🟩 Stats
- Orphans: N
- Broken links: N
- Stale project notes: N
- Old inbox items: N
- Contradictions: N
- Front-matter issues: N
```

## Refresh vault-context (optional)

If `$ARGUMENTS` includes `--refresh-context`, after the audit, regenerate `~/.claude/vault-context.md` to reflect current structure.

## Guardrails

- **Read-only by default.** `/lint` reports; it does not move, rename, or delete notes unless Charles explicitly says so in the same turn.
- If the audit finds more than 50 issues, truncate the report to the top 20 per category and note the total count.
- Don't report the same issue under multiple categories — pick the most specific bucket.
