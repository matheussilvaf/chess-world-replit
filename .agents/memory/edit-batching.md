---
name: Same-file edit batching
description: Tool-behavior lesson — batching many Edit calls to one file can silently drop some of them.
---

# Batching many edits to the SAME file can silently lose updates

Observed July 2026: 13 Edit calls to one large file in a single response — 3 reported success but never landed on disk. Separately, files with repeated near-identical blocks meant a "unique" anchor matched only the first occurrence, leaving duplicates unedited.

**Why:** concurrent same-file edits race; success output does not guarantee persistence when many edits target one file in one batch.

**How to apply:**
- Keep same-file edits to a few per response (2–4 with clearly distinct anchors is fine); for sweeping repeated-pattern changes prefer one `sed` + grep-verify, or a full WriteFile rewrite.
- ALWAYS verify after a multi-edit burst: `grep -c` for the new symbol and/or `tsc --noEmit` — cheap, and it caught every lost edit.
- Watch for duplicated code blocks in legacy files: verify occurrence counts, not just "edit succeeded".
