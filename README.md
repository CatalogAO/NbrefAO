<p align="center">
  <b>Nbref AO</b>
  <img src="20260731_225624.jpg"
</p>
<p align="center">A terminal AI CLI with installable skills, real tool execution, and multi-provider model support.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nbrefao"><img alt="npm" src="https://img.shields.io/npm/v/nbrefao?style=flat-square" /></a>
<p align="center">
  <a href="https://discord.gg/JsDd96nqb2"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://x.com/CatalogAO"><img alt="X" src="https://img.shields.io/badge/X-@CatalogAO-000000?style=flat-square&logo=x&logoColor=white" /></a>
</p>

---

Nbref AO (**AO**) is a terminal AI CLI. Point it at a project, chat with
it directly, or install a **skill** — an executable workflow, not just
documentation — and it reads the workflow, then carries it out: reading
and writing files, running shell commands, and (optionally) driving a
real browser to inspect a page.

### Installation

```bash
npm install -g nbrefao
```

Then run it from anywhere:

```bash
nbrefao
```

Or without installing globally:

```bash
npx nbrefao
```

Open directly in a specific project instead of `cd`-ing there first:

```bash
nbrefao ~/projects/my-app
```

Optional — only needed for skills that use browser tools (screenshots, page inspection):

```bash
npx playwright install chromium
```

> [!TIP]
> On first run you'll be asked to pick a provider, model, and enter an
> API key. That's remembered locally after that — you won't be asked
> again on future runs.

### Modes

AO includes two modes you switch between with **Ctrl+A**:

- **World** — default, read-only. AO can read files, list folders,
  fetch URLs, and browse pages to analyze and plan — but won't write,
  edit, or delete anything, and won't run shell commands.
- **Build** — full access. AO can create/edit/delete files, run shell
  commands (`npm install`, `git`, build scripts, ...), and drive a
  browser, all without asking for confirmation except for actions that
  are destructive, irreversible, cost money, or need information
  that's genuinely missing.

A skill invoked in Build mode executes autonomously end-to-end; the
same skill invoked in World mode only analyzes and proposes a plan.

### Skills

Skills aren't slash commands you memorize — they're workflows you
install from a link:

```
install skill ini https://github.com/owner/some-skill-repo
```

AO explores the repo itself (there's no fixed file-naming convention
it assumes), reads the real workflow, and registers whatever command
it exposes. `/skills` shows everything installed so far this session.

### Commands

Run `/help` inside AO for the full list. Highlights:

| Command | What it does |
| --- | --- |
| `/model`, `/provider` | Switch AI provider/model |
| `/skills`, `/install <link>` | View or install a skill |
| `/cd <path>` | Change the active project directory |
| `/new`, `/save`, `/load`, `/history`, `/search` | Conversation management |
| `/config`, `/theme`, `/memory` | Preferences |
| `/doctor` | Diagnose setup issues (API key, storage, Playwright) |

### Providers

Groq · OpenRouter · OpenAI · Anthropic · Gemini · DeepSeek

| Provider | Env var |
| --- | --- |
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

> [!NOTE]
> Anthropic support currently covers plain chat only — tool execution
> (Build mode, skills) isn't wired up for its native API format yet.

### ⚠️ Security

- **API keys are stored in plaintext** in `.nbref-ao/config.json`
  (local only, gitignored) so you're not asked for them every run.
  Don't commit that folder.
- **Build mode can run arbitrary shell commands** and is instructed to
  act autonomously without asking permission for non-destructive
  steps. Only use it on projects/machines you're comfortable giving an
  AI agent write + shell access to.
- **Installing a skill fetches and runs instructions from a URL you
  provide.** Treat skill sources the way you'd treat running someone
  else's script — only install from sources you trust.

### Development

Only needed if you're modifying AO itself, not for regular use:

```bash
git clone https://github.com/<you>/nbrefao.git
cd nbrefao
npm install
npm run dev
```

```bash
npm run typecheck   # tsc --noEmit
npm run build        # compiles src/ -> dist/
```

### Releasing

Publishing to npm happens via GitHub Actions when a release is published:

1. Bump `"version"` in `package.json`, commit it.
2. `git tag vX.Y.Z && git push --tags`
3. Create a GitHub Release from that tag.

Requires an `NPM_TOKEN` secret set on the repo (npmjs.com → Access
Tokens → Automation).

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

### Building on AO

If your project uses AO and includes "nbrefao"/"AO" as part of its
name — for example "ao-dashboard" — please note in your README that
it's not built by this project and isn't affiliated with it.

### Not intended for

Phishing, impersonation, scraping sites that prohibit it, or passing
off cloned designs as your own.

---

<p align="center">
  <b>Join the community</b><br/>
  <a href="https://discord.gg/JsDd96nqb2">Discord</a> · <a href="https://x.com/CatalogAO">X</a>
</p>

<p align="center">MIT License</p>
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
