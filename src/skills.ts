import { COMMANDS } from "./commands";

export interface Skill {
  id: string; // slug, derived from the skill's folder/command name
  name: string; // display name (from SKILL.md frontmatter, or the folder name)
  command: string; // the slash command used to invoke it, e.g. "/planning-with-files"
  description: string; // short description, for the /skills list + autocomplete
  instructions: string; // the full body of SKILL.md — read and followed by the AI when the skill is invoked
  source: string; // the link it was installed from
}

// in-memory registry for this session — matches how apiKeys are held in
// app.ts; nothing is persisted to disk
const installedSkills: Skill[] = [];

export function listSkills(): Skill[] {
  return installedSkills;
}

export function findSkillByCommand(command: string): Skill | undefined {
  return installedSkills.find((s) => s.command === command);
}

function parseGithubLink(
  link: string
): { owner: string; repo: string } | null {
  const cleaned = link.trim().replace(/\/+$/, "");
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo };
}

/** Resolves the repo's default branch via the GitHub API, falling back to common guesses. */
async function resolveDefaultBranch(owner: string, repo: string): Promise<string[]> {
  const branches = ["main", "master"];
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (res.ok) {
      const data = await res.json();
      if (data.default_branch && !branches.includes(data.default_branch)) {
        branches.unshift(data.default_branch);
      }
    }
  } catch {
    // ignore — we still have the main/master guesses to fall back on
  }
  return branches;
}

/**
 * Finds every SKILL.md file in the repo using the GitHub API's tree
 * endpoint, e.g.:
 *   .claude/skills/clone-website/SKILL.md
 *   .codex/skills/clone-website/SKILL.md
 * A repo often ships the same skill under several agent-specific
 * folders (.claude, .codex, .opencode, ...) that are kept in sync from
 * one source of truth — we prefer the .claude copy since that's
 * typically the canonical one, and fall back to whichever is found
 * first otherwise.
 */
async function findSkillFiles(
  owner: string,
  repo: string,
  branch: string
): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const resetHeader = res.headers.get("x-ratelimit-reset");
        const resetAt = resetHeader
          ? new Date(Number(resetHeader) * 1000).toLocaleTimeString()
          : "a few minutes";
        throw new Error(
          `GitHub API rate limit hit — unauthenticated requests are capped at 60/hour. Try again after ${resetAt}.`
        );
      }
    }
    if (res.status === 404) {
      throw new Error(`Branch "${branch}" or repo not found`);
    }
    throw new Error(`GitHub API error while listing files: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const paths: string[] = (data.tree ?? [])
    .filter((entry: any) => entry.type === "blob" && /\/SKILL\.md$/.test(entry.path))
    .map((entry: any) => entry.path);

  paths.sort((a, b) => {
    const aClaude = a.startsWith(".claude/") ? 0 : 1;
    const bClaude = b.startsWith(".claude/") ? 0 : 1;
    return aClaude - bClaude;
  });

  return paths;
}

/**
 * Pulls "name" and "description" out of a SKILL.md's YAML frontmatter
 * (--- ... ---) if present, and returns the remaining body separately.
 * Frontmatter is optional — if there isn't any, the whole file is
 * treated as the body and name/description are left undefined.
 */
function parseFrontmatter(text: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { body: text.trim() };

  const [, frontmatter, body] = match;
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "");

  return {
    name: nameMatch ? clean(nameMatch[1]) : undefined,
    description: descMatch ? clean(descMatch[1]) : undefined,
    body: body.trim(),
  };
}

/**
 * Fetches a skill's SKILL.md from its repo link and returns everything
 * needed to register + run it: the command name (from its folder), a
 * display name + description (from frontmatter if present, else
 * derived), and the full instructions body that gets fed to the AI
 * whenever the skill is invoked.
 */
async function detectSkill(link: string): Promise<{
  command: string;
  name: string;
  description: string;
  instructions: string;
}> {
  const repoInfo = parseGithubLink(link);
  if (!repoInfo) {
    throw new Error(
      "Only GitHub repo links are supported for now, e.g. https://github.com/owner/repo"
    );
  }
  const { owner, repo } = repoInfo;

  const branches = await resolveDefaultBranch(owner, repo);

  let skillPaths: string[] = [];
  let usedBranch = branches[0];
  let lastError: Error | null = null;

  for (const branch of branches) {
    try {
      skillPaths = await findSkillFiles(owner, repo, branch);
    } catch (err) {
      lastError = err as Error;
      // only keep trying other branch guesses for a genuine "branch not
      // found" — anything else (rate limiting, a real API error) will
      // fail the same way on every branch, so don't mask it
      if (!/not found/i.test(lastError.message)) {
        throw lastError;
      }
      continue;
    }
    if (skillPaths.length > 0) {
      usedBranch = branch;
      break;
    }
  }

  if (skillPaths.length === 0) {
    if (lastError) throw lastError;
    throw new Error(
      "Couldn't find a SKILL.md in that repo — make sure it's a valid skill repo"
    );
  }

  const skillPath = skillPaths[0];
  // the folder directly above SKILL.md is the skill's slug, e.g.
  // ".claude/skills/clone-website/SKILL.md" -> "clone-website"
  const folderMatch = skillPath.match(/([^/]+)\/SKILL\.md$/);
  const slug = folderMatch ? folderMatch[1] : repo;

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${usedBranch}/${skillPath}`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    throw new Error(`Found ${skillPath} but couldn't fetch its contents`);
  }
  const text = await res.text();

  const { name, description, body } = parseFrontmatter(text);
  if (!body) {
    throw new Error(`${skillPath} looks empty — nothing to install`);
  }

  return {
    command: `/${slug}`,
    name: name ?? slug,
    description: description ?? `Skill: ${name ?? slug}`,
    instructions: body,
  };
}

/**
 * Shared registration step used by both install paths:
 *  - the deterministic /install <link> command (detectSkill() above)
 *  - the AI-driven install_skill tool, where the model itself explored
 *    a repo and found the skill's instructions (not necessarily named
 *    SKILL.md — could be AGENTS.md, a doc under skills/, etc.)
 * Validates the command isn't already taken, registers it into
 * COMMANDS so it shows up in autocomplete, and stores the skill.
 */
export function registerSkill(parts: {
  command: string;
  name: string;
  description: string;
  instructions: string;
  source: string;
}): Skill {
  const command = parts.command.startsWith("/") ? parts.command : `/${parts.command}`;
  const id = command.slice(1);

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
    throw new Error(`"${command}" isn't a valid command name`);
  }
  if (!parts.instructions.trim()) {
    throw new Error("No instructions content — nothing to install");
  }

  const existingSkill = installedSkills.find((s) => s.id === id);
  if (existingSkill) {
    throw new Error(`"${existingSkill.name}" is already installed`);
  }

  const commandTaken = COMMANDS.find((c) => c.name === command);
  if (commandTaken) {
    throw new Error(`Can't install this skill — ${command} is already a built-in command`);
  }

  const skill: Skill = {
    id,
    name: parts.name || id,
    command,
    description: parts.description || `Skill: ${parts.name || id}`,
    instructions: parts.instructions,
    source: parts.source,
  };
  installedSkills.push(skill);
  COMMANDS.push({ name: command, description: skill.description });

  return skill;
}

/**
 * Installs a skill from a link the deterministic way: fetches its
 * SKILL.md directly (assumes the repo follows that convention) and
 * registers it. Fast and doesn't need a model call, but only works
 * when the repo actually has a SKILL.md file. For repos that don't
 * follow this convention, the AI-driven install_skill tool (see
 * tools.ts) explores the repo itself instead.
 */
export async function installSkill(link: string): Promise<Skill> {
  const trimmed = link.trim();

  if (!trimmed) {
    throw new Error("No link provided. Usage: /install <link>");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`"${trimmed}" doesn't look like a valid link`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Only http(s) links are supported");
  }

  const { command, name, description, instructions } = await detectSkill(trimmed);
  return registerSkill({ command, name, description, instructions, source: trimmed });
}
