import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { registerSkill } from "./skills";

const execAsync = promisify(exec);

// computed fresh on every use (not cached) so /cd can change the
// active project directory mid-session without restarting the CLI
function projectRoot(): string {
  return process.cwd();
}
const MAX_OUTPUT_CHARS = 8000;
const COMMAND_TIMEOUT_MS = 120_000;

// ───────────────────────────────────────────────────────────────
// BASE_TOOLS: safe to offer on every chat turn, not just active skill
// execution. Read-only (fetch_url) plus install_skill, which only
// registers a command — no filesystem writes, no shell, no browser.
// This is what lets a plain message like "install this skill:
// <link>" work without the user ever typing /install: the model
// explores the repo itself (via fetch_url against the GitHub API and
// raw.githubusercontent.com) and calls install_skill once it's found
// and read the real instructions — whatever the file happens to be
// named.
// ───────────────────────────────────────────────────────────────
export const BASE_TOOLS = [
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetch the raw content of a URL over HTTP(S) — HTML, JSON, or plain text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The URL to fetch" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_skill",
      description:
        "Register a skill so the user can invoke it later as a slash command. Only call this after you've actually located and read the skill's real instructions/workflow content in the repo — it might be a file called SKILL.md, AGENTS.md, something under a skills/ folder, or documented directly in the README. Never fabricate instructions; use fetch_url to explore the repo (e.g. https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1 to list files, https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path} to read one) before calling this.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              'The slash command to invoke this skill with, e.g. "/clone-website" — usually derived from the skill\'s file or folder name',
          },
          name: { type: "string", description: "A short display name for the skill" },
          description: { type: "string", description: "One-sentence description of what the skill does" },
          instructions: {
            type: "string",
            description: "The full instructions/workflow content you read from the skill's file, verbatim",
          },
          source: { type: "string", description: "The repo link this skill was installed from" },
        },
        required: ["command", "name", "description", "instructions", "source"],
      },
    },
  },
];

// ───────────────────────────────────────────────────────────────
// READ_ONLY_TOOLS: everything safe for World mode — reading files,
// listing folders, fetching URLs, browsing a page for inspection.
// Nothing here can modify the project or run arbitrary commands.
// ───────────────────────────────────────────────────────────────
export const READ_ONLY_TOOLS = [
  ...BASE_TOOLS,
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a text file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the project root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders inside a directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the project root (use \".\" for root)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description:
        "Open a real browser (or reuse the current one) and navigate to a URL. Returns the page title. Call this before browser_evaluate.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to navigate to" },
          viewport: {
            type: "string",
            enum: ["desktop", "mobile"],
            description: "Viewport size to render at (desktop: 1440px, mobile: 390px). Defaults to desktop.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_evaluate",
      description:
        "Run JavaScript inside the current browser page and return the (JSON-serializable) result. Use this to extract computed styles, fonts, colors, DOM structure, or to scroll/hover/click for behavior detection.",
      parameters: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description: "A JS expression or function body to evaluate in the page context",
          },
        },
        required: ["script"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_close",
      description: "Close the browser session. Call this once you're done inspecting the site.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ───────────────────────────────────────────────────────────────
// WRITE_TOOLS: only offered in Build mode — anything that touches the
// filesystem or runs a command. browser_screenshot lives here too
// since it writes an image file to disk.
// ───────────────────────────────────────────────────────────────
export const WRITE_TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a file or overwrite it entirely with new content. Creates parent folders automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the project root" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace one exact occurrence of old_text with new_text inside an existing file. old_text must match uniquely — include enough surrounding context.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the project root" },
          old_text: { type: "string", description: "Exact text to find (must be unique in the file)" },
          new_text: { type: "string", description: "Text to replace it with" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the project root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command in the project root (e.g. \"npm install\", \"npm run build\") and return its output.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Take a full-page screenshot of the current browser page and save it to a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Where to save the screenshot, relative to the project root" },
        },
        required: ["path"],
      },
    },
  },
];

const WRITE_TOOL_NAMES = new Set(
  WRITE_TOOLS.map((t) => t.function.name)
);

// ───────────────────────────────────────────────────────────────
// BUILD_TOOLS: the full set, only offered while in Build mode.
// ───────────────────────────────────────────────────────────────
export const BUILD_TOOLS = [...READ_ONLY_TOOLS, ...WRITE_TOOLS];

// ───────────────────────────────────────────────────────────────
// Path safety: every file tool is confined to the project root so a
// skill can't read/write/delete things outside the current project.
// ───────────────────────────────────────────────────────────────
function resolveSafe(relPath: string): string {
  const resolved = path.resolve(projectRoot(), relPath);
  if (resolved !== projectRoot() && !resolved.startsWith(projectRoot() + path.sep)) {
    throw new Error(`Refusing to access a path outside the project: ${relPath}`);
  }
  return resolved;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncated, ${text.length} chars total]`
    : text;
}

// ───────────────────────────────────────────────────────────────
// Browser session (Playwright) — lazily launched on first use, reused
// across calls within the same skill run so navigate/screenshot/evaluate
// all operate on the same page. Requires `playwright` to be installed:
//   npm install playwright && npx playwright install chromium
// ───────────────────────────────────────────────────────────────
let browserInstance: import("playwright").Browser | null = null;
let pageInstance: import("playwright").Page | null = null;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

async function getPage(viewport: "desktop" | "mobile" = "desktop") {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Playwright isn't installed. Run: npm install playwright && npx playwright install chromium"
    );
  }

  if (!browserInstance) {
    browserInstance = await playwright.chromium.launch();
  }
  if (!pageInstance) {
    pageInstance = await browserInstance.newPage();
  }
  await pageInstance.setViewportSize(VIEWPORTS[viewport]);
  return pageInstance;
}

async function closeBrowser() {
  if (pageInstance) {
    await pageInstance.close().catch(() => {});
    pageInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// exported so app.ts can make sure the browser doesn't linger when the
// process exits (e.g. on /exit or Ctrl+C)
export { closeBrowser };

// ───────────────────────────────────────────────────────────────
// Tool dispatcher. Never throws — every path resolves to a
// JSON-serializable result (with `success: false` + an error message
// on failure) so the model can see what went wrong and self-correct,
// per the "fix errors automatically" execution rule.
//
// `mode` is enforced here too, not just by which tools are offered in
// the request — if a write-capable tool somehow gets called while in
// World mode, it's rejected rather than executed.
// ───────────────────────────────────────────────────────────────
export async function executeTool(
  name: string,
  args: Record<string, any>,
  mode: "World" | "Build" = "Build"
): Promise<unknown> {
  if (mode !== "Build" && WRITE_TOOL_NAMES.has(name)) {
    return {
      success: false,
      error: `"${name}" needs Build mode — it modifies files or runs commands, which World mode doesn't allow. Ask the user to switch to Build mode (Ctrl+A) if this is needed.`,
    };
  }

  try {
    switch (name) {
      case "read_file": {
        const filePath = resolveSafe(args.path);
        const content = await fs.readFile(filePath, "utf-8");
        return { success: true, content: truncate(content) };
      }

      case "write_file": {
        const filePath = resolveSafe(args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content ?? "", "utf-8");
        return { success: true, path: args.path };
      }

      case "edit_file": {
        const filePath = resolveSafe(args.path);
        const original = await fs.readFile(filePath, "utf-8");
        const occurrences = original.split(args.old_text).length - 1;
        if (occurrences === 0) {
          return { success: false, error: "old_text not found in the file" };
        }
        if (occurrences > 1) {
          return {
            success: false,
            error: `old_text matched ${occurrences} times — it must be unique, add more context`,
          };
        }
        const updated = original.replace(args.old_text, args.new_text ?? "");
        await fs.writeFile(filePath, updated, "utf-8");
        return { success: true, path: args.path };
      }

      case "delete_file": {
        const filePath = resolveSafe(args.path);
        await fs.unlink(filePath);
        return { success: true, path: args.path };
      }

      case "list_dir": {
        const dirPath = resolveSafe(args.path ?? ".");
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return {
          success: true,
          entries: entries.map((e: any) => (e.isDirectory() ? `${e.name}/` : e.name)),
        };
      }

      case "run_command": {
        try {
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: projectRoot(),
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 20 * 1024 * 1024,
          });
          return { success: true, stdout: truncate(stdout), stderr: truncate(stderr) };
        } catch (err: any) {
          // a failing command (e.g. build error) is not a tool failure —
          // hand the model its stdout/stderr/exit code so it can fix it
          return {
            success: false,
            exitCode: err.code,
            stdout: truncate(err.stdout ?? ""),
            stderr: truncate(err.stderr ?? String(err.message)),
          };
        }
      }

      case "fetch_url": {
        const res = await fetch(args.url);

        if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
          const resetHeader = res.headers.get("x-ratelimit-reset");
          const resetAt = resetHeader
            ? new Date(Number(resetHeader) * 1000).toLocaleTimeString()
            : "later";
          return {
            success: false,
            rateLimited: true,
            error: `GitHub API rate limit hit (unauthenticated requests are capped at 60/hour). Retrying this or other GitHub API URLs won't help until it resets around ${resetAt}. Stop and report this to the user instead of retrying.`,
          };
        }

        const text = await res.text();
        return { success: res.ok, status: res.status, content: truncate(text) };
      }

      case "install_skill": {
        const skill = registerSkill({
          command: args.command,
          name: args.name,
          description: args.description,
          instructions: args.instructions,
          source: args.source,
        });
        return { success: true, command: skill.command, name: skill.name };
      }

      case "browser_navigate": {
        const page = await getPage(args.viewport ?? "desktop");
        await page.goto(args.url, { waitUntil: "networkidle" });
        return { success: true, title: await page.title(), url: page.url() };
      }

      case "browser_screenshot": {
        if (!pageInstance) {
          return { success: false, error: "No active browser page — call browser_navigate first" };
        }
        const filePath = resolveSafe(args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await pageInstance.screenshot({ path: filePath, fullPage: true });
        return { success: true, path: args.path };
      }

      case "browser_evaluate": {
        if (!pageInstance) {
          return { success: false, error: "No active browser page — call browser_navigate first" };
        }
        // wrap as a function body so the model can write multi-statement
        // scripts with `return`, e.g. "return getComputedStyle(document.body).fontFamily;"
        const result = await pageInstance.evaluate(`() => { ${args.script} }`);
        return { success: true, result };
      }

      case "browser_close": {
        await closeBrowser();
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
