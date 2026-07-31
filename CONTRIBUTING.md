# Contributing

Thanks for considering a contribution — this is a small, solo-maintained
project, so keeping things simple matters more than heavy process.

## Setup

```bash
git clone https://github.com/<you>/nbrefao.git
cd nbrefao
npm install
npm run dev          # runs directly via tsx, no build step needed
```

## Before opening a PR

```bash
npm run typecheck    # tsc --noEmit — must pass with no errors
npm run build         # confirms it actually compiles to dist/
```

There's no test suite yet — if you're adding a non-trivial feature,
a quick manual run-through of the affected commands/flows is enough
for now.

## Guidelines

- Keep changes focused — one feature/fix per PR is easier to review
  than a bundle of unrelated changes.
- Match the existing style: comments explain *why*, not just *what*;
  tool/command handlers stay small and delegate to a `handleX()`
  function rather than being inlined into the main loop.
- If you add a new slash command, register it in `commands.ts` **and**
  wire a handler + dispatch line in `app.ts` — commands that only exist
  in `commands.ts` just show up in autocomplete and do nothing, which
  is confusing.
- If you touch anything in `tools.ts` that writes files or runs
  commands, make sure it's still gated correctly by World/Build mode.
- Security-sensitive changes (anything touching API key storage,
  `run_command`, or the skill-install flow) — please explain the
  reasoning in the PR description, since those are the areas most
  likely to bite someone if gotten wrong.

## Reporting bugs / ideas

Open an issue, or use `/bug` and `/feedback` inside the CLI itself
(saved locally to `.nbref-ao/` — feel free to copy the relevant bits
into a GitHub issue).
