#!/usr/bin/env node
import chalk from "chalk";
import { promises as fsp } from "fs";
import path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { promptInput } from "./inputbox";
import { selectProvider, selectModel } from "./modelPicker";
import { promptApiKey } from "./apiKeyPrompt";
import { selectSetupOption } from "./setupPicker";
import { PROVIDERS, Provider } from "./models";
import { selectSkill } from "./skillsPicker";
import { installSkill, listSkills, findSkillByCommand, Skill } from "./skills";
import { BASE_TOOLS, READ_ONLY_TOOLS, WRITE_TOOLS, BUILD_TOOLS, executeTool, closeBrowser } from "./tools";
import { Spinner, labelForTool } from "./spinner";
import { readJSON, writeJSON, deleteFile, appendLog, storeDirPath } from "./store";
import { THEMES, findTheme, Theme } from "./theme";
import { COMMANDS } from "./commands";

const execAsync = promisify(exec);
const CLI_NAME = "Nbref AO";
const CLI_VERSION = "0.1.0";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[]; // present on an assistant message that requested tool use
  tool_call_id?: string; // present on a "tool" message, links back to the request
}

const MAX_TOOL_ITERATIONS = 40;

// in-memory API keys for this session, seeded from env vars if present
const apiKeys: Record<string, string> = {};
for (const p of PROVIDERS) {
  if (process.env[p.envKey]) apiKeys[p.id] = process.env[p.envKey] as string;
}

// default to the first provider/model that already has a key, else the first provider
let currentProvider: Provider =
  PROVIDERS.find((p) => apiKeys[p.id]) || PROVIDERS[0];
let currentModelId: string = currentProvider.models[0].id;

// session-wide state, shared by the main loop and the /command handlers below
const history: ChatMessage[] = [];
let activeSkill: Skill | null = null; // once a skill is invoked, it stays active for the rest of the session
let aoMode: "World" | "Build" = "World"; // toggled with Ctrl+A in the input box, persists across turns
let lastInjectedMode: "World" | "Build" | null = null;
let currentTheme: Theme = THEMES[0];
let memoryNotes: string[] = [];
const sessionStats = { messagesSent: 0, toolCalls: 0, startedAt: Date.now() };

function printWelcomeBox(text: string) {
  const accent = chalk.bold.hex("#e0724a");
  const inner = `> ${text}`;
  const innerWidth = inner.length + 2;

  const top = accent("┏" + "━".repeat(innerWidth) + "┓");
  const middle = accent("┃") + ` ${chalk.bold.white(inner)} ` + accent("┃");
  const bottom = accent("┗" + "━".repeat(innerWidth) + "┛");

  console.log(top);
  console.log(middle);
  console.log(bottom);
}

function printSentMessage(text: string) {
  const label = `> ${text}`;
  console.log(chalk.bold.bgWhite.black(label));
}

/**
 * Converts a stream of text chunks containing markdown "**bold**" markers
 * into real ANSI bold escape codes, handling "**" split across chunk
 * boundaries (since deltas can arrive mid-token).
 */
function createBoldStreamer() {
  let boldOn = false;
  let carry = "";

  const feed = (chunk: string): string => {
    let text = carry + chunk;
    carry = "";

    if (text.endsWith("*") && !text.endsWith("**")) {
      carry = "*";
      text = text.slice(0, -1);
    }

    let out = "";
    let i = 0;
    while (i < text.length) {
      if (text[i] === "*" && text[i + 1] === "*") {
        boldOn = !boldOn;
        out += boldOn ? "\x1b[1m" : "\x1b[22m";
        i += 2;
      } else {
        out += text[i];
        i++;
      }
    }
    return out;
  };

  const flush = (): string => {
    const leftover = carry;
    carry = "";
    const reset = boldOn ? "\x1b[22m" : "";
    boldOn = false;
    return leftover + reset;
  };

  return { feed, flush };
}

/**
 * Ensures we have an API key for the given provider. If missing, prompts
 * the user right away and stores it in-memory for the rest of the session.
 */
async function ensureApiKey(provider: Provider): Promise<boolean> {
  if (apiKeys[provider.id]) return true;

  const key = await promptApiKey(provider.name);
  if (!key) {
    console.log(chalk.gray("Cancelled — no API key entered."));
    return false;
  }

  apiKeys[provider.id] = key;
  await persistApiKey(provider.id, key);
  console.log(chalk.gray(`✓ ${provider.name} API key saved — you won't need to enter it again`));
  return true;
}

/**
 * Saves an API key into the local config file (.nbref-ao/config.json)
 * so it's remembered across restarts — this is what lets setup be
 * skipped next time. It's stored in plaintext locally, the same way
 * tools like the GitHub or AWS CLI keep credentials on disk; the
 * .nbref-ao folder should stay out of version control (see .gitignore).
 */
async function persistApiKey(providerId: string, key: string): Promise<void> {
  const config = await readJSON<Record<string, string>>("config.json", {});
  config[`apikey-${providerId}`] = key;
  config["setup-complete"] = "true";
  await writeJSON("config.json", config);
}

/**
 * Injects a "● " bullet at the very start of the response and again after
 * every blank line (paragraph break), so each reasoning step / paragraph
 * gets its own bullet like Claude Code does. Handles "\n\n" split across
 * chunk boundaries.
 */
function createBulletStreamer() {
  let lastChar = "\n"; // pretend we start right after a newline so the very first char gets a bullet
  let needBullet = true;

  const feed = (chunk: string): string => {
    let out = "";
    for (const c of chunk) {
      if (needBullet && c !== "\n") {
        out += chalk.bold.white("● ");
        needBullet = false;
      }
      if (c === "\n" && lastChar === "\n") {
        needBullet = true;
      }
      out += c;
      lastChar = c;
    }
    return out;
  };

  return { feed };
}

/** Anthropic doesn't take a "system" role inside messages — it's a separate top-level field. */
function splitSystemPrompt(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return { system, rest: messages.filter((m) => m.role !== "system") };
}

/**
 * Anthropic only knows "user"/"assistant" turns and requires them to
 * alternate, starting with "user". This folds in any leftover "tool"
 * messages (from a prior Groq/OpenAI-format skill run in the same
 * conversation) as plain user text, and merges consecutive same-role
 * messages so the alternation requirement holds.
 */
function toAnthropicTurns(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    const content = m.role === "tool" ? `[tool result] ${m.content}` : m.content;
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content += "\n\n" + content;
    } else {
      turns.push({ role, content });
    }
  }
  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "(continue)" });
  }
  return turns;
}

function buildRequestHeaders(): Record<string, string> {
  if (currentProvider.apiFormat === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKeys[currentProvider.id],
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKeys[currentProvider.id]}`,
  };
}

async function sendToAI(messages: ChatMessage[]): Promise<string> {
  const isAnthropic = currentProvider.apiFormat === "anthropic";
  let res: Response;
  let rateLimitAttempts = 0;
  const spinner = new Spinner();
  spinner.start("Thinking");

  try {
    while (true) {
      const body = isAnthropic
        ? (() => {
            const { system, rest } = splitSystemPrompt(messages);
            return {
              model: currentModelId,
              max_tokens: 4096,
              ...(system ? { system } : {}),
              messages: toAnthropicTurns(rest),
              stream: true,
            };
          })()
        : { model: currentModelId, messages, stream: true };

      res = await fetch(currentProvider.baseUrl, {
        method: "POST",
        headers: buildRequestHeaders(),
        body: JSON.stringify(body),
      });

      if (res.ok) break;

      const detail = await res.text().catch(() => "");
      let parsed: any = null;
      try {
        parsed = JSON.parse(detail);
      } catch {
        // not JSON — fall through to the generic error below
      }

      if (res.status === 429 && rateLimitAttempts < RATE_LIMIT_MAX_RETRIES) {
        rateLimitAttempts++;
        const waitSeconds = parseRetryDelaySeconds(res, parsed);
        spinner.setLabel(`Rate limited, waiting ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        spinner.setLabel("Thinking");
        continue;
      }

      throw new Error(`API error: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
    }

    if (!res.body) {
      throw new Error("API error: response had no body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let firstTokenSeen = false;

    const bullet = createBulletStreamer();
    const bold = createBoldStreamer();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const delta = isAnthropic
            ? (json.type === "content_block_delta" && json.delta?.type === "text_delta"
                ? json.delta.text
                : undefined)
            : json.choices?.[0]?.delta?.content;

          if (delta) {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              spinner.stop();
              process.stdout.write("\n");
            }
            process.stdout.write(bold.feed(bullet.feed(delta)));
            full += delta;
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }

    process.stdout.write(bold.flush());
    process.stdout.write("\n\n");
    return full;
  } finally {
    spinner.stop();
  }
}

const TOOL_USE_FAILED_RETRIES = 2;
const RATE_LIMIT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads how long to wait before retrying a 429 — prefers the
 * Retry-After header, falls back to parsing Groq's "Please try again
 * in 18.89s" from the error message, and otherwise a safe default.
 */
function parseRetryDelaySeconds(res: Response, parsedBody: any): number {
  const header = res.headers.get("retry-after");
  if (header && !isNaN(Number(header))) return Number(header);

  const msg: string = parsedBody?.error?.message ?? "";
  const match = msg.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]));

  return 5;
}

/**
 * Non-streaming provider call used by the agentic loop below. Tool
 * calling and streaming don't mix well (tool_call argument fragments
 * arrive across many deltas that have to be reassembled), so skill
 * execution trades live token-by-token streaming for getting complete,
 * directly-usable tool_calls back on every turn.
 *
 * Retries automatically on two known-transient failure modes:
 *  - 400 "tool_use_failed": Groq's tool-calling models occasionally
 *    emit a malformed pseudo-function-call instead of a proper
 *    structured tool call — a non-deterministic generation glitch,
 *    not a request problem, so Groq recommends just retrying.
 *  - 429 rate limiting (tokens-per-minute): waits out the delay Groq
 *    reports, then retries — this is expected to happen occasionally
 *    on lower-tier plans during longer tool-calling tasks.
 * Any other error (bad schema, auth, etc.) fails immediately since
 * retrying won't change the outcome.
 */
async function callProviderWithTools(
  messages: ChatMessage[],
  tools: unknown[],
  onStatus?: (label: string) => void
): Promise<any> {
  if (currentProvider.apiFormat === "anthropic") {
    throw new Error(
      "Skills and tool-based execution aren't supported on Anthropic yet in this build (its tool-calling format is different from the other providers) — switch to Groq/OpenAI/OpenRouter/Gemini/DeepSeek to run skills, or use Anthropic for plain chat."
    );
  }

  let toolUseFailedAttempts = 0;
  let rateLimitAttempts = 0;

  while (true) {
    const res = await fetch(currentProvider.baseUrl, {
      method: "POST",
      headers: buildRequestHeaders(),
      body: JSON.stringify({
        model: currentModelId,
        messages,
        stream: false,
        tools,
        tool_choice: "auto",
      }),
    });

    if (res.ok) return res.json();

    const detail = await res.text().catch(() => "");
    let parsed: any = null;
    try {
      parsed = JSON.parse(detail);
    } catch {
      // not JSON — fall through to the generic error below
    }

    if (res.status === 429 && rateLimitAttempts < RATE_LIMIT_MAX_RETRIES) {
      rateLimitAttempts++;
      const waitSeconds = parseRetryDelaySeconds(res, parsed);
      onStatus?.(`Rate limited, waiting ${waitSeconds}s`);
      await sleep(waitSeconds * 1000);
      onStatus?.("Thinking");
      continue;
    }

    if (parsed?.error?.code === "tool_use_failed" && toolUseFailedAttempts < TOOL_USE_FAILED_RETRIES) {
      toolUseFailedAttempts++;
      onStatus?.("Retrying");
      continue;
    }

    throw new Error(`API error: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (s.length <= 70) return `${k}: ${s}`;
      // keep head + tail so distinguishing details (query params, branch
      // names, file paths) don't get silently swallowed by truncation —
      // e.g. two different branch/recursive params on an otherwise
      // identical-looking GitHub API URL
      return `${k}: ${s.slice(0, 40)}...${s.slice(-25)}`;
    })
    .join(", ");
}

/**
 * Agentic execution loop: keeps calling the model with the given tools
 * available, actually running whatever tool it asks for, and feeding
 * the real result back — repeating until the model stops requesting
 * tools (task considered done) or MAX_TOOL_ITERATIONS is hit as a
 * safety cap.
 *
 * Used a few ways:
 *  - with READ_ONLY_TOOLS in World mode, for an active skill that
 *    should only analyze/plan, not touch the project
 *  - with BUILD_TOOLS in Build mode, for an active skill actually
 *    doing the work (file edits, shell commands, browser actions, ...)
 *  - with BASE_TOOLS, for an ordinary message that looks like it's
 *    asking to install a skill from a link — just fetch_url +
 *    install_skill, nothing destructive, regardless of mode
 *
 * `mode` is passed through to executeTool as a second enforcement
 * layer — even if a write tool weren't in `tools` at all, this makes
 * sure it can't run while in World mode.
 *
 * Any assistant text the model sends along the way is printed as a
 * progress update; per the skill-execution system prompt, that should
 * just be short status lines, not planning or narration.
 */
async function runAgenticLoop(
  history: ChatMessage[],
  tools: unknown[],
  mode: "World" | "Build"
): Promise<void> {
  const spinner = new Spinner();
  spinner.start("Thinking");

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const data = await callProviderWithTools(history, tools, (label) => spinner.setLabel(label));
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("No response from model");

      const toolCalls: ToolCall[] = message.tool_calls ?? [];

      if (message.content) {
        spinner.stop();
        console.log(chalk.white(`● ${message.content}`));
      }

      history.push({
        role: "assistant",
        content: message.content ?? "",
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });

      if (toolCalls.length === 0) {
        spinner.stop();
        return; // model made no further tool requests — task is done
      }

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // leave args empty; executeTool will report back that it got bad input
        }

        spinner.start(labelForTool(call.function.name, args));
        const result = await executeTool(call.function.name, args, mode);
        spinner.stop();
        sessionStats.toolCalls++;

        console.log(chalk.gray(`  ▸ ${call.function.name}(${summarizeArgs(args)})`));

        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }

      spinner.start("Thinking");
    }

    spinner.stop();
    console.log(
      chalk.yellow(`! Stopped after ${MAX_TOOL_ITERATIONS} tool calls — task may be incomplete`)
    );
  } finally {
    spinner.stop();
  }
}

/**
 * Lightweight heuristic used to decide whether an ordinary message
 * (not a recognized slash command) should be routed through the tool
 * loop instead of a plain streaming chat reply: does it contain a link
 * plus install-ish wording? This is what lets "install skill ini
 * https://github.com/..." work without ever typing /install.
 */
function looksLikeInstallRequest(text: string): boolean {
  const hasUrl = /https?:\/\/\S+/.test(text);
  const hasIntent = /\b(install|instal|pasang|tambah(kan)?)\b.*\bskill/i.test(text) ||
    /\bskill\b.*\b(install|instal|pasang|tambah(kan)?)\b/i.test(text);
  return hasUrl && hasIntent;
}

/**
 * System prompt for the install-intent path: tells the model to
 * explore the linked repo itself (there's no fixed convention it can
 * assume) rather than guessing, and to keep its own commentary short.
 */
function buildInstallIntentSystemPrompt(): string {
  return [
    `The user wants to install a skill from a link in their message.`,
    `A "skill" is a workflow/instructions file in the repo — it might be named SKILL.md, AGENTS.md, something under a skills/ or .claude/ folder, or documented directly in the README. There's no fixed convention, so explore the repo yourself:`,
    `1. Use fetch_url on the GitHub API to list the repo's files, e.g. https://api.github.com/repos/{owner}/{repo}/git/trees/main?recursive=1 (try "master" if "main" 404s, or fetch https://api.github.com/repos/{owner}/{repo} first to read "default_branch").`,
    `2. Find the file most likely to be the skill's actual instructions/workflow.`,
    `3. Read its full raw content with fetch_url on the matching https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path} URL.`,
    `4. Call install_skill with a command name derived from the skill (e.g. its folder/file name), and the full instructions content you actually read — never invent instructions you haven't read.`,
    `Keep your own messages to one or two short status lines (e.g. "Exploring repo...", "Found clone-website skill, installing..."). Don't narrate your exploration step by step.`,
    `If a fetch_url call fails, read the error message in its result before trying again. If it says the request was rate-limited, do not retry the same or a similar URL — stop and tell the user what happened instead. Never call the exact same URL more than once.`,
  ].join("\n");
}

/**
 * /models flow: pick a provider first (Groq, OpenRouter, ...), then pick
 * a model from that provider. OpenRouter has its own menu since it has
 * many models. If the provider has no API key yet, ask for it immediately.
 */
async function handleModelsCommand() {
  const pickedProvider = await selectProvider(PROVIDERS, currentProvider.id);
  if (!pickedProvider) return; // cancelled

  const pickedModel = await selectModel(
    pickedProvider.models,
    pickedProvider.name,
    pickedProvider.id === currentProvider.id ? currentModelId : undefined
  );
  if (!pickedModel) return; // cancelled

  const ok = await ensureApiKey(pickedProvider);
  if (!ok) return;

  currentProvider = pickedProvider;
  currentModelId = pickedModel.id;
  const config = await readJSON<Record<string, string>>("config.json", {});
  config["default-provider"] = pickedProvider.id;
  config["default-model"] = pickedModel.id;
  config["setup-complete"] = "true";
  await writeJSON("config.json", config);
  console.log(
    chalk.gray(`✓ Switched to ${pickedProvider.name} · ${pickedModel.name}`)
  );
}

/**
 * /skills flow: show the picker with everything installed so far this
 * session. Selecting one returns its command so the caller can drop it
 * straight into the next input prompt — same idea as picking a slash
 * command from the autocomplete dropdown.
 */
async function handleSkillsCommand(): Promise<string | null> {
  const picked = await selectSkill(listSkills());
  if (!picked) return null; // cancelled or nothing to pick

  return `${picked.command} `;
}

/**
 * /install <link>: installs a skill from a link, which registers a new
 * slash command (from its SKILL.md's folder name, e.g.
 * .../clone-website/SKILL.md -> /clone-website) into the in-memory
 * registry for this session.
 */
async function handleInstallCommand(link: string) {
  try {
    const skill = await installSkill(link);
    console.log(
      chalk.gray(`✓ Installed "${skill.name}" — use it with ${skill.command}`)
    );
  } catch (err) {
    console.log(chalk.red(`! ${(err as Error).message}`));
  }
}

// ───────────────────────────────────────────────────────────────
// Handlers for the rest of the commands in commands.ts.
// ───────────────────────────────────────────────────────────────

function handleHelp() {
  console.log(chalk.bold.white("Commands"));
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  for (const c of COMMANDS) {
    console.log(chalk.gray(`  ${c.name.padEnd(width)}${c.description}`));
  }
}

async function handleInit() {
  const cwd = process.cwd();
  let pkgInfo = "no package.json found";
  try {
    const raw = await fsp.readFile(path.join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    pkgInfo = `${pkg.name ?? "unnamed"}@${pkg.version ?? "0.0.0"}`;
  } catch {
    // no package.json — leave the default message
  }

  let entries: string[] = [];
  try {
    entries = await fsp.readdir(cwd);
  } catch {
    // unreadable cwd — leave entries empty
  }

  console.log(chalk.bold.white("Project initialized"));
  console.log(chalk.gray(`  path: ${cwd}`));
  console.log(chalk.gray(`  package: ${pkgInfo}`));
  console.log(chalk.gray(`  top-level files: ${entries.slice(0, 20).join(", ") || "(empty)"}`));
  console.log(chalk.gray(`  Use /skills or /install <link> to add a workflow, then invoke it to get started.`));
}

/**
 * /cd <path>: switches the CLI's active working/project directory
 * without needing to quit and re-launch from a different folder. All
 * file/shell tools (read_file, write_file, run_command, ...) resolve
 * relative to process.cwd(), so this immediately takes effect.
 */
async function handleCd(arg: string) {
  if (!arg) {
    console.log(chalk.gray(`Current directory: ${process.cwd()}`));
    return;
  }

  const target = path.resolve(process.cwd(), arg);
  try {
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) {
      console.log(chalk.red(`! Not a directory: ${target}`));
      return;
    }
    process.chdir(target);
    console.log(chalk.gray(`✓ Now working in ${process.cwd()}`));
  } catch {
    console.log(chalk.red(`! No such directory: ${target}`));
  }
}

function handleNew() {
  history.length = 0;
  activeSkill = null;
  console.log(chalk.gray("✓ Started a new conversation"));
}

function handleClear() {
  console.clear();
}

function handleHistory() {
  if (history.length === 0) {
    console.log(chalk.gray("(no messages yet)"));
    return;
  }
  console.log(chalk.bold.white("History"));
  for (const m of history) {
    if (m.role === "tool") continue; // raw tool results are noisy, skip them
    const preview = m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content;
    console.log(chalk.gray(`  [${m.role}] ${preview}`));
  }
}

async function handleSave() {
  await writeJSON("session.json", {
    savedAt: new Date().toISOString(),
    provider: currentProvider.id,
    model: currentModelId,
    mode: aoMode,
    history,
  });
  console.log(chalk.gray(`✓ Saved session to ${path.join(storeDirPath(), "session.json")}`));
}

async function handleLoad() {
  const data = await readJSON<any>("session.json", null);
  if (!data) {
    console.log(chalk.yellow("! No saved session found — use /save first."));
    return;
  }
  history.length = 0;
  history.push(...(Array.isArray(data.history) ? data.history : []));
  if (data.mode === "World" || data.mode === "Build") aoMode = data.mode;
  const provider = PROVIDERS.find((p) => p.id === data.provider);
  if (provider) {
    currentProvider = provider;
    if (provider.models.some((m) => m.id === data.model)) currentModelId = data.model;
  }
  console.log(chalk.gray(`✓ Loaded session saved ${new Date(data.savedAt).toLocaleString()}`));
}

async function handleSearch(query: string) {
  if (!query) {
    console.log(chalk.yellow("! Usage: /search <keyword>"));
    return;
  }
  const q = query.toLowerCase();
  const matches = history.filter((m) => m.role !== "tool" && m.content.toLowerCase().includes(q));

  if (matches.length === 0) {
    console.log(chalk.gray(`No matches for "${query}" in the current conversation`));
    return;
  }

  console.log(chalk.bold.white(`${matches.length} match(es) for "${query}"`));
  for (const m of matches) {
    const idx = m.content.toLowerCase().indexOf(q);
    const start = Math.max(0, idx - 30);
    const snippet = m.content.slice(start, idx + q.length + 30).trim();
    console.log(chalk.gray(`  [${m.role}] ...${snippet}...`));
  }
}

function handleContext() {
  const approxTokens = Math.round(history.reduce((sum, m) => sum + m.content.length, 0) / 4);
  console.log(chalk.bold.white("Context"));
  console.log(chalk.gray(`  messages: ${history.length}`));
  console.log(chalk.gray(`  approx tokens: ~${approxTokens}`));
  console.log(chalk.gray(`  provider: ${currentProvider.name}`));
  console.log(chalk.gray(`  model: ${currentModelId}`));
  console.log(chalk.gray(`  mode: ${aoMode}`));
  console.log(chalk.gray(`  active skill: ${activeSkill ? activeSkill.command : "none"}`));
}

async function handleMemory(arg: string) {
  const spaceIdx = arg.indexOf(" ");
  const sub = spaceIdx === -1 ? arg : arg.slice(0, spaceIdx);
  const text = (spaceIdx === -1 ? "" : arg.slice(spaceIdx + 1)).trim();

  if (sub === "add" && text) {
    memoryNotes.push(text);
    await writeJSON("memory.json", memoryNotes);
    console.log(chalk.gray(`✓ Remembered: ${text}`));
    return;
  }

  if (sub === "clear") {
    memoryNotes = [];
    await writeJSON("memory.json", memoryNotes);
    console.log(chalk.gray("✓ Memory cleared"));
    return;
  }

  if (memoryNotes.length === 0) {
    console.log(chalk.gray("(nothing remembered yet — use /memory add <text>)"));
    return;
  }
  console.log(chalk.bold.white("Memory"));
  memoryNotes.forEach((n, i) => console.log(chalk.gray(`  ${i + 1}. ${n}`)));
}

async function handleConfig(arg: string) {
  const parts = arg.split(" ").filter(Boolean);
  const config = await readJSON<Record<string, string>>("config.json", {});

  if (parts[0] === "set" && parts[1] && parts[2]) {
    const key = parts[1];
    const value = parts.slice(2).join(" ");
    config[key] = value;
    await writeJSON("config.json", config);
    console.log(chalk.gray(`✓ Set ${key} = ${value} (used next time you start ${CLI_NAME})`));
    return;
  }

  console.log(chalk.bold.white("Config"));
  console.log(chalk.gray(`  provider: ${currentProvider.id}`));
  console.log(chalk.gray(`  model: ${currentModelId}`));
  console.log(chalk.gray(`  theme: ${currentTheme.name}`));
  console.log(chalk.gray(`  storage: ${process.cwd()}`));
  if (Object.keys(config).length > 0) {
    console.log(chalk.gray(`  saved defaults: ${JSON.stringify(config)}`));
  }
  console.log(chalk.gray(`  usage: /config set <default-provider|default-model|theme> <value>`));
}

function handleTheme(arg: string) {
  const name = arg.trim();

  if (!name) {
    console.log(chalk.bold.white("Themes"));
    for (const t of THEMES) {
      const marker = t.name === currentTheme.name ? "●" : " ";
      console.log(chalk.gray(`  ${marker} ${t.name}`));
    }
    console.log(chalk.gray(`  usage: /theme <name>`));
    return;
  }

  const theme = findTheme(name);
  if (!theme) {
    console.log(
      chalk.yellow(`! Unknown theme "${name}". Options: ${THEMES.map((t) => t.name).join(", ")}`)
    );
    return;
  }

  currentTheme = theme;
  console.log(chalk.gray(`✓ Theme set to ${theme.name}`));
}

function handleToolsList() {
  console.log(chalk.bold.white("Tools"));
  console.log(chalk.gray("  Read-only (available in World mode):"));
  for (const t of READ_ONLY_TOOLS as any[]) {
    console.log(chalk.gray(`    ${t.function.name} — ${t.function.description}`));
  }
  console.log(chalk.gray("  Write (Build mode only):"));
  for (const t of WRITE_TOOLS as any[]) {
    console.log(chalk.gray(`    ${t.function.name} — ${t.function.description}`));
  }
}

function handleStatus() {
  const uptimeSec = Math.floor((Date.now() - sessionStats.startedAt) / 1000);
  console.log(chalk.bold.white("Session status"));
  console.log(chalk.gray(`  provider: ${currentProvider.name}`));
  console.log(chalk.gray(`  model: ${currentModelId}`));
  console.log(chalk.gray(`  mode: ${aoMode}`));
  console.log(chalk.gray(`  active skill: ${activeSkill ? activeSkill.command : "none"}`));
  console.log(chalk.gray(`  messages sent: ${sessionStats.messagesSent}`));
  console.log(chalk.gray(`  tool calls: ${sessionStats.toolCalls}`));
  console.log(chalk.gray(`  uptime: ${uptimeSec}s`));
}

function handleTokens() {
  const approxTokens = Math.round(history.reduce((sum, m) => sum + m.content.length, 0) / 4);
  console.log(chalk.bold.white("Token usage (approx)"));
  console.log(chalk.gray(`  ~${approxTokens} tokens in the current context`));
  console.log(chalk.gray(`  (rough estimate: 1 token ≈ 4 characters, actual usage may differ)`));
}

function handleStats() {
  const uptimeSec = Math.floor((Date.now() - sessionStats.startedAt) / 1000);
  console.log(chalk.bold.white("Stats"));
  console.log(chalk.gray(`  messages sent: ${sessionStats.messagesSent}`));
  console.log(chalk.gray(`  tool calls: ${sessionStats.toolCalls}`));
  console.log(chalk.gray(`  skills installed: ${listSkills().length}`));
  console.log(chalk.gray(`  session uptime: ${uptimeSec}s`));
}

function handleVersion() {
  console.log(chalk.gray(`${CLI_NAME} v${CLI_VERSION}`));
}

async function handleUpdate() {
  console.log(chalk.gray("Checking for updates..."));
  try {
    const { stdout } = await execAsync("git pull --ff-only", { cwd: process.cwd() });
    console.log(chalk.gray(stdout.trim() || "Already up to date."));
  } catch {
    console.log(
      chalk.yellow(
        "! Couldn't check for updates automatically (not a git repo, no network, or local changes in the way). Update manually if needed."
      )
    );
  }
}

async function handleFeedback(text: string) {
  if (!text) {
    console.log(chalk.yellow("! Usage: /feedback <your message>"));
    return;
  }
  await appendLog("feedback.log", `[${new Date().toISOString()}] ${text}`);
  console.log(chalk.gray("✓ Thanks — feedback saved locally."));
}

async function handleBug(text: string) {
  if (!text) {
    console.log(chalk.yellow("! Usage: /bug <describe the issue>"));
    return;
  }
  const report = [
    `[${new Date().toISOString()}]`,
    `provider: ${currentProvider.id}, model: ${currentModelId}, mode: ${aoMode}`,
    `description: ${text}`,
    `---`,
  ].join("\n");
  await appendLog("bugs.log", report);
  console.log(chalk.gray(`✓ Bug report saved to ${path.join(storeDirPath(), "bugs.log")}`));
}

async function handleDoctor() {
  console.log(chalk.bold.white("Diagnostics"));
  console.log(chalk.gray(`  node: ${process.version}`));
  console.log(
    chalk.gray(
      `  ${currentProvider.name} API key: ` +
        (apiKeys[currentProvider.id] ? chalk.green("present") : chalk.yellow("missing"))
    )
  );

  let storageOk = false;
  try {
    await writeJSON("doctor-check.json", { ok: true });
    await deleteFile("doctor-check.json");
    storageOk = true;
  } catch {
    storageOk = false;
  }
  console.log(chalk.gray(`  local storage writable: `) + (storageOk ? chalk.green("yes") : chalk.red("no")));

  try {
    await import("playwright");
    console.log(chalk.gray(`  playwright: `) + chalk.green("installed"));
  } catch {
    console.log(chalk.gray(`  playwright: `) + chalk.yellow("not installed — browser tools won't work"));
  }
}

async function handleReset() {
  history.length = 0;
  activeSkill = null;
  aoMode = "World";
  memoryNotes = [];
  currentTheme = THEMES[0];
  await deleteFile("config.json");
  await deleteFile("memory.json");
  await deleteFile("session.json");
  console.log(chalk.gray("✓ Reset to defaults"));
}

function handleRestart() {
  console.log(chalk.gray("Restarting..."));
  const child = spawn(process.argv[0], process.argv.slice(1), {
    stdio: "inherit",
    detached: true,
  });
  child.unref();
  process.exit(0);
}

/**
 * Builds the system message that gets pushed into the conversation
 * whenever a skill is invoked. A skill is an executable workflow, not
 * documentation — so this doesn't just hand over the SKILL.md body, it
 * explicitly puts the model into execution mode: read the workflow
 * internally, then start doing the work immediately instead of
 * explaining, summarizing, or asking for permission to proceed.
 */
/**
 * System prompt used for ordinary chat (no skill invoked) once tools
 * are enabled — explains what World/Build mode allows so a plain
 * request like "buatkan file app.py" actually gets acted on via tools
 * instead of just described, while still respecting the mode boundary.
 */
function buildBaseModeSystemPrompt(mode: "World" | "Build"): string {
  if (mode === "Build") {
    return [
      `You have file, shell, and browser tools available.`,
      `You're in Build mode: when the user asks you to create, write, or edit a file, or run a command, do it directly using the tools — don't just describe what you would do.`,
      `Don't ask for confirmation unless the action is destructive, irreversible, costs money, or needs information that's genuinely missing.`,
      `Verify results and fix errors automatically where you can.`,
    ].join("\n");
  }
  return [
    `You have read-only tools available: read files, list folders, fetch URLs, browse pages.`,
    `You're in World mode: no file writes, no shell commands. Use the read-only tools to explore/answer when helpful.`,
    `If the user asks you to create or edit files, or run a command, say you're in World mode and suggest switching to Build mode (Ctrl+A) — don't pretend to do it.`,
  ].join("\n");
}

function buildSkillSystemPrompt(skill: Skill, mode: "World" | "Build"): string {
  const header = `You are running skill "${skill.name}" (${skill.command}) — it defines a workflow, not a document to discuss.`;

  if (mode === "World") {
    return [
      header,
      ``,
      `You are in World mode: analysis and planning only.`,
      `1. Read the skill's instructions below completely and understand the workflow they describe.`,
      `2. Explore and read the project as needed (read_file, list_dir, fetch_url, browser tools are available) to inform your analysis.`,
      `3. You do NOT have write_file, edit_file, delete_file, run_command, or browser_screenshot this turn — don't attempt them, and don't narrate as if you used them.`,
      `4. Present your analysis, architecture thinking, or a concrete plan for the task directly in your reply — this is exactly what World mode is for.`,
      `5. If the task genuinely requires making changes, say so plainly and suggest switching to Build mode (Ctrl+A) — don't pretend to make the changes anyway.`,
      ``,
      `This skill stays active for the entire task, not just the first message.`,
      ``,
      `--- ${skill.name} ---`,
      skill.instructions,
    ].join("\n");
  }

  return [
    header,
    ``,
    `You are in Build mode: execute the workflow.`,
    `Execution rules:`,
    `1. Read the skill's instructions below completely and understand them internally.`,
    `2. Do not explain the workflow, summarize the skill, or list the steps you're about to take.`,
    `3. Do not ask for permission to continue, unless the next action is destructive, irreversible, requires credentials, costs money, or needs information that is genuinely missing — in every other case, just proceed.`,
    `4. Begin executing the first actionable step immediately, then keep going — use tools automatically, and create, edit, or delete files as the workflow requires.`,
    `5. Verify your results. If something fails, investigate, fix it, and retry automatically — only ask the user if it truly can't be resolved on your own.`,
    `6. Keep executing, step after step, until the task is genuinely complete. Don't stop after each step to check in.`,
    `7. For long tasks, output only short progress updates (e.g. "Inspecting website...", "Generating components...", "Build successful.") — not planning text, checklists, or "here is what I will do" preambles.`,
    `8. If the skill asks you to create or update specific files (e.g. a plan or progress file), do so exactly as instructed — that's workflow bookkeeping, not user-facing narration.`,
    `9. Keep using your normal coding ability throughout — the skill changes the workflow, not your capabilities.`,
    ``,
    `This skill stays active for the entire task, not just the first message.`,
    ``,
    `--- ${skill.name} ---`,
    skill.instructions,
  ].join("\n");
}

async function main() {
  const argDir = process.argv[2];
  if (argDir) {
    const target = path.resolve(argDir);
    try {
      const stat = await fsp.stat(target);
      if (stat.isDirectory()) {
        process.chdir(target);
      } else {
        console.log(chalk.yellow(`! "${argDir}" isn't a directory — staying in ${process.cwd()}`));
      }
    } catch {
      console.log(chalk.yellow(`! Couldn't find "${argDir}" — staying in ${process.cwd()}`));
    }
  }

  memoryNotes = await readJSON<string[]>("memory.json", []);
  const savedConfig = await readJSON<Record<string, string>>("config.json", {});

  if (savedConfig["default-provider"]) {
    const p = PROVIDERS.find((p) => p.id === savedConfig["default-provider"]);
    if (p) currentProvider = p;
  }
  if (savedConfig["default-model"] && currentProvider.models.some((m) => m.id === savedConfig["default-model"])) {
    currentModelId = savedConfig["default-model"];
  }
  if (savedConfig["theme"]) {
    const t = findTheme(savedConfig["theme"]);
    if (t) currentTheme = t;
  }
  // restore any API keys saved from a previous session (env vars still
  // win if both are set, since apiKeys was already seeded from them above)
  for (const p of PROVIDERS) {
    const saved = savedConfig[`apikey-${p.id}`];
    if (saved && !apiKeys[p.id]) apiKeys[p.id] = saved;
  }

  const alreadySetUp = savedConfig["setup-complete"] === "true" && !!apiKeys[currentProvider.id];

  if (!alreadySetUp) {
    let setupChoice = await selectSetupOption();

    // "Key" means "use Nbref's already-configured default key" — if
    // there isn't one, there's nothing to fall back to, so just send
    // the user straight into the ApiKey flow instead of leaving them
    // stuck with a provider they can't actually use.
    if (setupChoice === "key" && !apiKeys[currentProvider.id]) {
      setupChoice = "apikey";
    }

    if (setupChoice === "apikey") {
      // same flow as /models: pick provider, pick model, ask for its key
      await handleModelsCommand();
    } else {
      // confirmed to have a usable key already (env var) — just mark
      // setup complete so this screen is skipped next time
      const config = await readJSON<Record<string, string>>("config.json", {});
      config["setup-complete"] = "true";
      config["default-provider"] = currentProvider.id;
      config["default-model"] = currentModelId;
      await writeJSON("config.json", config);
    }
  }

  printWelcomeBox("Welcome to Nbref AO");
  console.log("");

  let nextPrefill = "";

  while (true) {
    const currentModelName =
      currentProvider.models.find((m) => m.id === currentModelId)?.name ?? currentModelId;

    const { text: userInput, mode: submittedMode } = await promptInput({
      placeholder: "Type your message...",
      header: "> tips on using /init to streamline the use of Nbref AO",
      initialValue: nextPrefill,
      mode: aoMode,
      modelLabel: currentModelName,
      storageLabel: process.cwd(),
      worldColor: currentTheme.worldColor,
      buildColor: currentTheme.buildColor,
    });
    aoMode = submittedMode;
    nextPrefill = "";

    if (!userInput.trim()) continue;

    const trimmedInput = userInput.trim();
    const spaceIdx = trimmedInput.indexOf(" ");
    const cmd = spaceIdx === -1 ? trimmedInput : trimmedInput.slice(0, spaceIdx);
    const arg = spaceIdx === -1 ? "" : trimmedInput.slice(spaceIdx + 1).trim();

    if (cmd === "/exit") {
      await closeBrowser();
      console.log(chalk.gray("bye 👋"));
      process.exit(0);
    }

    if (cmd === "/model") {
      await handleModelsCommand();
      continue;
    }

    if (cmd === "/skills") {
      const picked = await handleSkillsCommand();
      if (picked) nextPrefill = picked;
      continue;
    }

    if (cmd === "/install") {
      await handleInstallCommand(arg);
      continue;
    }

    if (cmd === "/help") {
      handleHelp();
      continue;
    }

    if (cmd === "/init") {
      await handleInit();
      continue;
    }

    if (cmd === "/cd") {
      await handleCd(arg);
      continue;
    }

    if (cmd === "/new") {
      handleNew();
      continue;
    }

    if (cmd === "/clear") {
      handleClear();
      continue;
    }

    if (cmd === "/history") {
      handleHistory();
      continue;
    }

    if (cmd === "/save") {
      await handleSave();
      continue;
    }

    if (cmd === "/load" || cmd === "/resume") {
      await handleLoad();
      continue;
    }

    if (cmd === "/search") {
      await handleSearch(arg);
      continue;
    }

    if (cmd === "/provider") {
      await handleModelsCommand();
      continue;
    }

    if (cmd === "/context") {
      handleContext();
      continue;
    }

    if (cmd === "/memory") {
      await handleMemory(arg);
      continue;
    }

    if (cmd === "/config" || cmd === "/settings") {
      await handleConfig(arg);
      continue;
    }

    if (cmd === "/theme") {
      handleTheme(arg);
      continue;
    }

    if (cmd === "/tools") {
      handleToolsList();
      continue;
    }

    if (cmd === "/status") {
      handleStatus();
      continue;
    }

    if (cmd === "/tokens") {
      handleTokens();
      continue;
    }

    if (cmd === "/stats") {
      handleStats();
      continue;
    }

    if (cmd === "/version") {
      handleVersion();
      continue;
    }

    if (cmd === "/update") {
      await handleUpdate();
      continue;
    }

    if (cmd === "/feedback") {
      await handleFeedback(arg);
      continue;
    }

    if (cmd === "/bug") {
      await handleBug(arg);
      continue;
    }

    if (cmd === "/doctor") {
      await handleDoctor();
      continue;
    }

    if (cmd === "/reset") {
      await handleReset();
      continue;
    }

    if (cmd === "/restart") {
      handleRestart();
      continue;
    }

    let toSend: ChatMessage[];
    let isInstallIntent = false;

    if (cmd.startsWith("/")) {
      const skill = findSkillByCommand(cmd);
      if (skill) {
        if (!arg) {
          console.log(
            chalk.yellow(
              `! ${skill.command} needs a task, e.g. "${skill.command} <describe what you want>"`
            )
          );
          continue;
        }
        activeSkill = skill;
        toSend = [
          { role: "system", content: buildSkillSystemPrompt(skill, aoMode) },
          { role: "user", content: arg },
        ];
      } else {
        toSend = [{ role: "user", content: userInput }];
      }
    } else if (!activeSkill && looksLikeInstallRequest(userInput)) {
      isInstallIntent = true;
      toSend = [
        { role: "system", content: buildInstallIntentSystemPrompt() },
        { role: "user", content: userInput },
      ];
    } else {
      const toolsCapable = currentProvider.apiFormat !== "anthropic";
      if (toolsCapable && lastInjectedMode !== aoMode) {
        toSend = [
          { role: "system", content: buildBaseModeSystemPrompt(aoMode) },
          { role: "user", content: userInput },
        ];
        lastInjectedMode = aoMode;
      } else {
        toSend = [{ role: "user", content: userInput }];
      }
    }

    if (!apiKeys[currentProvider.id]) {
      console.log(
        chalk.yellow(`! No API key set up yet — pick a provider and model first.`)
      );
      await handleModelsCommand();
      if (!apiKeys[currentProvider.id]) continue; // still cancelled/missing, try again next loop
    }

    printSentMessage(userInput);
    sessionStats.messagesSent++;
    for (const m of toSend) history.push(m);

    try {
      if (activeSkill) {
        const tools = aoMode === "Build" ? BUILD_TOOLS : READ_ONLY_TOOLS;
        await runAgenticLoop(history, tools, aoMode);
      } else if (isInstallIntent) {
        await runAgenticLoop(history, BASE_TOOLS, aoMode);
      } else if (currentProvider.apiFormat === "anthropic") {
        const reply = await sendToAI(history);
        history.push({ role: "assistant", content: reply });
      } else {
        const tools = aoMode === "Build" ? BUILD_TOOLS : READ_ONLY_TOOLS;
        await runAgenticLoop(history, tools, aoMode);
      }
    } catch (err) {
      console.log(chalk.red(`\n! Error: ${(err as Error).message}\n`));
    }
  }
}

main();
