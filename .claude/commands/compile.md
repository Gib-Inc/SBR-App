---
description: Turn raw notes in a vault folder into polished wiki pages
argument-hint: "<folder path, e.g. '03 - Resources/' or '00 - Inbox/'>"
---

# /compile — Notes → wiki pages

Target folder: **$ARGUMENTS**

Take the raw material in the target folder and produce coherent, linkable wiki pages. This is the "clean-up and publish" pass — it turns scratch notes into reference docs.

## Process

1. **Scan.** List every `.md` file in the target folder (recursive). Read each one.

2. **Cluster.** Group notes by topic. A cluster is 2+ notes that talk about the same thing. Singletons stay singletons.

3. **For each cluster, produce a wiki page** at the target folder's root (or a sensible sub-folder):
   - Title: the canonical topic name (Title Case)
   - Front matter: `date` (today), `type: wiki`, `status: published`, `tags`, `sources` (list of source notes)
   - Sections: **Summary**, **Key points**, **How it connects**, **References** (wikilinks to the source notes), **See also** (links to adjacent topics already in the vault)
   - Merge overlapping content; note contradictions explicitly rather than papering over them

4. **For each singleton note:**
   - Move it to the right place (sub-folder by topic, or up to Charles)
   - Add front matter if missing
   - Fix broken wikilinks
   - Add a one-line summary at the top if absent

5. **Source notes.** After a note is folded into a wiki page:
   - Add `> Folded into [[Wiki Page Name]] — YYYY-MM-DD` at the top of the source
   - Tag with `#folded`
   - Do **not** delete — the receipts trail matters

6. **Index.** Update or create `<folder>/INDEX.md` with:
   - One-liner per wiki page
   - Count of folded source notes per page
   - Any singletons not yet clustered, flagged for future passes

7. **Report.**
   - New pages created: list with links
   - Notes folded: count
   - Contradictions found: list them explicitly
   - Suggested follow-up research: flag topics with thin coverage

   Save the report to `_output/reports/compile-<folder-slug>-$(date +%Y-%m-%d).md`.

## Edge cases

- **Empty folder:** report "Nothing to compile in `$ARGUMENTS` as of $(date +%Y-%m-%d)" and stop. Don't invent content.
- **One-file folder:** skip clustering, just normalize the single file.
- **No common theme:** leave notes as-is, report the topic diversity, suggest manual re-filing.
- **Binary / non-md files:** skip, list them in the report.

## Guardrails

- Never delete source notes.
- Never merge contradictory claims silently — always flag.
- Preserve all `[[wikilinks]]` from source notes in the compiled pages.
- If a compile would need to change more than 20 files, ask Charles before committing to it.
- Don't move notes out of `00 - Inbox/` during `/compile` — that's `/lint`'s job. Stay scoped to the target folder.
