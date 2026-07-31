# Nbref AO

A terminal AI chat CLI with installable skills (executable workflows, not
just docs), real tool-calling (read/write files, run shell commands,
browser automation), World/Build mode gating, and support for 6
providers: Groq, OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek.

## Install

```bash
npm install
npx playwright install chromium   # optional — only needed for browser tools
```

## Run

```bash
npm start
```

On first run you'll be asked to pick a provider, model, and enter an API
key (or set one via environment variable beforehand, e.g. `GROQ_API_KEY`).
Setup is remembered after that — you won't be asked again on the next run.

## Environment variables

| Provider | Env var |
|---|---|
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

## Commands

Run `/help` inside the CLI for the full list. Highlights:

- `/model` — switch provider/model
- `/skills`, `/install <link>` — view/install skills (installing works
  either via `/install`, or just by asking in chat, e.g. "install skill
  ini <link>" — the AI explores the repo itself)
- `/new`, `/save`, `/load`, `/history`, `/search` — conversation management
- `/config`, `/theme`, `/memory` — preferences

## World / Build mode

Toggle with **Ctrl+A**. **World** mode is read-only (analysis and
planning only — no file writes, no shell commands). **Build** mode can
create/edit/delete files and run shell commands. Skills invoked while
in Build mode execute autonomously without asking for confirmation
except for destructive/irreversible actions.

## ⚠️ Security notes

- **API keys are stored in plaintext** in `.nbref-ao/config.json` (local
  only, gitignored) so you don't have to re-enter them every run. Don't
  commit that folder.
- **Build mode can run arbitrary shell commands** via the `run_command`
  tool, and the AI is instructed to execute skills autonomously without
  asking permission for non-destructive steps. Only use Build mode on
  projects/machines you're comfortable an AI agent having write + shell
  access to.
- **`/install` and "install this skill" fetch and run instructions from
  a URL you provide.** A skill's instructions get fed directly to the
  model as things to follow — treat skill sources the same way you'd
  treat running someone else's script: only install from sources you
  trust.
- Anthropic support currently covers plain chat only — skills/tool
  execution isn't wired up for Anthropic's native API format yet.

## Not intended for

Phishing, impersonation, scraping sites that prohibit it, or passing
off cloned designs as your own. See the `/copy-site`-style skills'
own licensing/usage terms for specifics.

## License

MIT
