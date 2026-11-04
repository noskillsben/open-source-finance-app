# Domain Docs

This repo has no `GLOSSARY.md`, no `GLOSSARY-MAP.md` and no `docs/adr/`. Never create them.

## Before exploring, read these

- **`docs/design/DESIGN.md`** is the domain documentation and the source of truth. Use its vocabulary. Its decision log holds what ADRs would.
- `CLAUDE.md` for the terminology list (for example "ready to assign", never "reconcile").

## Writing

- `/grill-with-docs` and `domain-modeling` are question-only: ask, sharpen terms, cross-check the code, and write nothing to disk.
- The one exception is inside `/decide`, where the session is the Architect and may edit `docs/design/` for Ben to review. Nowhere else edits `docs/design/`.
- `/research` posts its finding on the issue. Only inside `/decide` does a file land in `docs/design/`.

## Flag conflicts

If your output contradicts DESIGN.md or its decision log, say so explicitly; DESIGN.md wins.
