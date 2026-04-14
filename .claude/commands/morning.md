---
description: Daily briefing compiled from the vault — active projects, inbox, open questions
argument-hint: "[optional: focus area, e.g. 'sbr' or 'marketing']"
---

# /morning — Daily briefing

Today is **$(date +%Y-%m-%d)**. Compose a terse, scannable briefing from the vault. Skip pleasantries. Charles wants the state of the world in under one screen.

## Pull from

1. **`~/.claude/vault-context.md`** — for current vault layout
2. **`MASTER-PATH-TO-SUCCESS.md`** at vault root — north-star goals (if missing, note it)
3. **`00 - Inbox/`** — every file, sorted newest-first
4. **`01 - Projects/*/`** — each project's most recently modified file
5. **Recent git log** on `Gib-Inc/SBR-App` — last 10 commits, note anything unusual
6. **Focus filter:** if `$ARGUMENTS` is provided, narrow to that project/area

## Emit (markdown, in this order)

### 📌 Today's Intent
One line pulled from `MASTER-PATH-TO-SUCCESS.md` or the active sprint doc. If nothing obvious, ask Charles.

### 📥 Inbox ({N} items)
For each item in `00 - Inbox/` not tagged `#filed`:
- `[[filename]]` — one-line summary — age (e.g. "2d old") — suggested destination (`01 - Projects/...`, `03 - Resources/...`)

### 🔨 Active Projects
For each folder in `01 - Projects/`:
- **Project name** — most recent note's one-liner — last-modified date — next action (if a `next-actions.md` or equivalent exists, pull the top item)

### ⚠️ Stale & Orphans
- Notes in `01 - Projects/` not touched in 14+ days
- Notes in `00 - Inbox/` more than 7 days old
- Broken `[[wikilinks]]` (point these out but don't auto-fix)

### 🧠 Open Questions
Any note with a `#needs-decision` or `#blocked` tag. One line each.

### 🚢 Recent Ships (SBR repo)
Last 5 commits on main, one line each, grouped by area if obvious.

## Style

- No emojis in the body (section headers only).
- File references as `[[wikilinks]]` so they render in Obsidian.
- If the vault is empty or sparse, say so — don't pad.
- Keep under 40 lines. If something is worth more, suggest Charles ask for a drill-down.

## After emitting

Save a copy to `_output/reports/briefing-$(date +%Y-%m-%d).md` for later reference.
