# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/design-decisions.md`**: this repo's decision log, in the role `docs/adr/` plays elsewhere, with one numbered section per decision. Read the sections that touch the area you're about to work in.

If `CONTEXT.md` doesn't exist yet, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved.

## Recording decisions

Record a new decision as the next numbered section of `docs/design-decisions.md`, in the shape of the existing sections, rather than as a file under `docs/adr/`. Wherever a skill says "ADR", read it as a numbered section of that file ("ADR-0009" → "§ 9").

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/design-decisions.md   ← decision log, one numbered section per decision
├── app/
├── components/
└── lib/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts an existing decision, surface it explicitly rather than silently overriding:

> _Contradicts design-decisions § 9 (OIDC trust pinned to GitHub's immutable subject claim), but worth reopening because…_
