import chalk from "chalk";
import * as readline from "readline";
import { COMMANDS, SlashCommand } from "./commands";

/**
 * Renders a simple line-style input prompt (no box border), with a live
 * autocomplete dropdown for slash commands, navigable with ↑↓.
 *
 * Redraw technique: on every re-render we move the cursor back up to the
 * top of the box and erase everything from there to the end of screen
 * (\x1b[J) before redrawing. The number of rows to move up is computed
 * from the actual rendered content (accounting for lines that wrap
 * across multiple terminal columns), not just the number of logical
 * lines — that way the box redraws correctly no matter how many rows it
 * actually occupied on screen last time.
 *
 * Note: an earlier version of this used DECSC/DECRC (\x1b7 / \x1b8) to
 * save/restore the cursor position. That doesn't work here: those escape
 * codes save an absolute row/column on screen. As soon as printing the
 * box scrolls the terminal (which happens as soon as there's more
 * content above than fits on screen), the saved position no longer
 * points at the top of the box, so restoring it lands in the wrong
 * place — old content never gets erased and a new box gets drawn below
 * it, stacking up on every keystroke.
 *
 * ─────────────────────────────────────
 * > /effo█
 * ─────────────────────────────────────
 * /effort       Set effort level for model usage
 * /feedback     Send feedback
 *
 * Usage:
 *   const answer = await promptInput({ placeholder: "Ask anything..." });
 */

interface InputBoxOptions {
  placeholder?: string;
  width?: number; // total line width; defaults based on terminal width
  header?: string; // optional line rendered above the rule; erased together with it on submit
  hint?: string; // optional hint line rendered below the box, e.g. "? for shortcuts"
  initialValue?: string; // pre-fill the buffer, e.g. "/clone-website " after picking a skill
  mode?: "World" | "Build"; // current ao mode, shown next to the hint; toggled with Ctrl+A
  modelLabel?: string; // shown as "model:<label>" next to the hint
  storageLabel?: string; // shown as "storage:<label>" next to the hint
  worldColor?: string; // hex color for the "World" word, set via /theme
  buildColor?: string; // hex color for the "Build" word, set via /theme
}

interface InputResult {
  text: string;
  mode: "World" | "Build";
}

export function promptInput(options: InputBoxOptions = {}): Promise<InputResult> {
  const {
    placeholder = "",
    width = Math.min(process.stdout.columns || 80, 100),
    header,
    hint = "? for shortcuts",
    initialValue = "",
    modelLabel,
    storageLabel,
    worldColor = "#4dabf7",
    buildColor = "#ff5fa2",
  } = options;

  let mode: "World" | "Build" = options.mode ?? "World";

  let buffer = initialValue;
  let suggestionIndex = 0;
  let previousRowCount = 0;

  // strip ANSI escape codes so we measure the actual visible width of a
  // line, not the raw string length (which would be inflated by chalk's
  // color codes and throw off the row-wrapping calculation below)
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

  // a single logical line can wrap into multiple terminal rows depending
  // on its visible length vs. the terminal width
  const rowsForLine = (line: string): number =>
    Math.max(1, Math.ceil(stripAnsi(line).length / width));

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdout.write("\x1b[?25l"); // hide real cursor, we draw our own

    const fakeCursor = chalk.white("█");
    const rule = chalk.gray("━".repeat(width));

    // suggestions only show once the user has typed at least one char of
    // the command name after "/" (not on a bare "/"), and stop once a
    // space is typed (command name is finalized, now typing args)
    const getSuggestions = (): SlashCommand[] => {
      if (!buffer.startsWith("/") || buffer.includes(" ") || buffer.length < 2)
        return [];
      const q = buffer.toLowerCase();
      return COMMANDS.filter((c) => c.name.toLowerCase().startsWith(q));
    };

    const renderInputLine = (): string => {
      if (buffer.length === 0) {
        return `${chalk.bold.white(">")} ${fakeCursor}${chalk.gray(
          placeholder.slice(1)
        )}`;
      }

      return `${chalk.bold.white(">")} ${chalk.white(buffer)}${fakeCursor}`;
    };

    // ao:World / ao:Build — the mode word itself is bold blue/pink;
    // everything else in the status line (hint, "ao:", model, storage)
    // stays gray to match "? for shortcuts"
    const buildStatusLine = (): string => {
      const modeWord =
        mode === "World"
          ? chalk.bold.hex(worldColor)("World")
          : chalk.bold.hex(buildColor)("Build");

      const segments = [chalk.gray(hint), chalk.gray("ao:") + modeWord];
      if (modelLabel) segments.push(chalk.gray(`model:${modelLabel}`));
      if (storageLabel) segments.push(chalk.gray(`storage:${storageLabel}`));

      return "  " + segments.join(chalk.gray("   "));
    };

    const buildLines = (): string[] => {
      const lines = [rule, renderInputLine(), rule];

      const suggestions = getSuggestions();
      if (suggestionIndex >= suggestions.length)
        suggestionIndex = Math.max(0, suggestions.length - 1);

      if (suggestions.length > 0) {
        const nameColWidth =
          Math.max(...suggestions.map((s) => s.name.length)) + 2;

        suggestions.forEach((cmd, i) => {
          const isSelected = i === suggestionIndex;
          const namePadded = cmd.name.padEnd(nameColWidth);
          let line = `${namePadded}${cmd.description}`;

          if (line.length > width) {
            line = line.slice(0, Math.max(0, width - 1)) + "…";
          }

          lines.push(isSelected ? chalk.bold.white(line) : chalk.gray(line));
        });
      } else if (hint) {
        lines.push(buildStatusLine());
      }

      if (header) lines.unshift(chalk.gray(header));
      return lines;
    };

    const render = () => {
      const lines = buildLines();

      if (previousRowCount > 0) {
        // move cursor back up to the top row of the previous render...
        process.stdout.write(`\x1b[${previousRowCount}A`);
        // ...then to column 0 and erase everything from here to the
        // bottom of the screen, so the old box is fully gone before we
        // draw the new one
        process.stdout.write("\x1b[G\x1b[J");
      }

      for (const line of lines) {
        process.stdout.write(line + "\n");
      }

      previousRowCount = lines.reduce((sum, l) => sum + rowsForLine(l), 0);
    };

    render(); // initial draw

    const eraseBox = () => {
      if (previousRowCount > 0) {
        process.stdout.write(`\x1b[${previousRowCount}A`);
        process.stdout.write("\x1b[G\x1b[J");
      }
      previousRowCount = 0;
    };

    const onKeypress = (str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      const suggestions = getSuggestions();

      // Ctrl+A toggles the mode — works reliably on Termux (CTRL +
      // letter via the extra-keys row) without the Tab-byte-collision
      // issues Ctrl/Shift+Tab can have on some terminals.
      if (key.ctrl && key.name === "a") {
        mode = mode === "World" ? "Build" : "World";
        render();
        return;
      }

      if (key.name === "up" && suggestions.length > 0) {
        suggestionIndex = Math.max(0, suggestionIndex - 1);
        render();
        return;
      }

      if (key.name === "down" && suggestions.length > 0) {
        suggestionIndex = Math.min(
          suggestions.length - 1,
          suggestionIndex + 1
        );
        render();
        return;
      }

      if (key.name === "return") {
        // if a suggestion is showing, Enter accepts it into the buffer
        // instead of submitting, so the user can keep typing arguments
        if (suggestions.length > 0) {
          buffer = suggestions[suggestionIndex].name + " ";
          suggestionIndex = 0;
          render();
          return;
        }

        eraseBox();
        cleanup();
        resolve({ text: buffer, mode });
        return;
      }

      if (key.name === "backspace") {
        buffer = buffer.slice(0, -1);
        suggestionIndex = 0;
      } else if (str && !key.ctrl && !key.meta) {
        buffer += str;
        suggestionIndex = 0;
      }

      render();
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?25h"); // show real cursor again
    };

    process.stdin.on("keypress", onKeypress);
  });
}
