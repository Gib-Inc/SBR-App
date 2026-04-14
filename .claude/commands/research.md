---
description: Research a topic, capture sources, and file the output into the vault
argument-hint: "<topic or question>"
---

# /research — Research and file

Topic: **$ARGUMENTS**

Produce a research note that Charles can actually use — sources cited, claims tagged as fact vs. opinion, and filed to the right PARA folder.

## Steps

1. **Clarify scope.** If `$ARGUMENTS` is vague (one word, ambiguous), ask ONE clarifying question before searching. Otherwise proceed.

2. **Gather.** Use WebSearch + WebFetch for external sources. Use Grep + Read for anything already in the vault or repo. Prefer primary sources (official docs, RFCs, vendor pages) over secondary. Capture the URL for every source.

3. **Synthesize.** Write a note in this shape:

   ```markdown
   ---
   date: YYYY-MM-DD
   type: research
   topic: <topic>
   status: draft
   tags: [resource/research, <domain-tag>]
   sources: <N>
   ---

   # <Topic>

   ## TL;DR
   Two–four sentences. What did I learn? Why does it matter for GIB.E?

   ## Context
   Why am I looking this up? What triggered it?

   ## Findings
   Bullets. Each bullet cites a source like `([Name](url))`. Mark opinions as _(opinion)_.

   ## Implications for SBR / L2 / GIB.E
   How does this change what we do? Concrete, or flagged as "needs decision".

   ## Open questions
   What I still don't know. Tag `#needs-decision` where applicable.

   ## Sources
   1. [Title](url) — one-line why-this-source
   2. ...
   ```

4. **File.** Save based on what the research is for:
   - External reference material → `03 - Resources/<domain>/<slug>.md`
   - Tied to an active project → `01 - Projects/<project>/research/<slug>.md`
   - Could go either way → ask Charles

5. **Link it.** Add a `[[wikilink]]` from any related existing note if one obviously belongs (e.g. sprint doc, project README).

6. **Dump raw sources.** Save a raw capture (quotes + URLs, no synthesis) to `_output/query-results/research-<slug>-$(date +%Y-%m-%d).md`. This is the receipts trail.

7. **Report back.** One paragraph: what you found, where you filed it, what you didn't answer. Link to the new note.

## Guardrails

- Never fabricate sources or URLs. If you can't find something, say so.
- If a finding conflicts with an SBR non-negotiable (see project `CLAUDE.md`), flag it explicitly — don't bury the conflict in a bullet.
- No emojis in filed notes.
- If the research touches secrets, credentials, or customer data, stop and ask Charles before filing.
