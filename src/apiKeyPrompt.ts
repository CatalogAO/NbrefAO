import * as readline from "readline";
import chalk from "chalk";

/**
 * Prompts for an API key with masked input (shows * instead of the real
 * characters). Enter submits, Esc cancels (resolves "").
 *
 * Uses row-counting cursor movement for redraw (see inputbox.ts for why
 * DECSC/DECRC save-cursor/restore-cursor breaks once the box scrolls).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Enter your Groq API key
 * > ****************█
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export function promptApiKey(providerName: string): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    let previousRowCount = 0;

    const width = Math.min(process.stdout.columns || 80, 100);
    const rule = chalk.bold.white("━".repeat(width));
    const fakeCursor = chalk.white("█");

    const rowsForLine = (line: string): number =>
      Math.max(1, Math.ceil(line.replace(/\x1b\[[0-9;]*m/g, "").length / width));

    const buildLines = (): string[] => {
      const masked = "*".repeat(buffer.length);
      const text = buffer.length
        ? `${chalk.bold.white(">")} ${masked}${fakeCursor}`
        : `${chalk.bold.white(">")} ${fakeCursor}${chalk.gray(
            "paste your key here..."
          )}`;

      return [
        chalk.bold.white(`Enter your ${providerName} API key`),
        rule,
        text,
        rule,
      ];
    };

    const render = () => {
      const lines = buildLines();

      if (previousRowCount > 0) {
        process.stdout.write(`\x1b[${previousRowCount}A`);
        process.stdout.write("\x1b[G\x1b[J");
      }

      for (const line of lines) {
        process.stdout.write(line + "\n");
      }

      previousRowCount = lines.reduce((sum, l) => sum + rowsForLine(l), 0);
    };

    render();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdout.write("\x1b[?25l");

    const eraseBox = () => {
      if (previousRowCount > 0) {
        process.stdout.write(`\x1b[${previousRowCount}A`);
        process.stdout.write("\x1b[G\x1b[J");
      }
      previousRowCount = 0;
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?25h");
    };

    const onKeypress = (str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        eraseBox();
        cleanup();
        process.exit(0);
      }

      if (key.name === "escape") {
        eraseBox();
        cleanup();
        resolve("");
        return;
      }

      if (key.name === "return") {
        eraseBox();
        cleanup();
        resolve(buffer.trim());
        return;
      }

      if (key.name === "backspace") {
        buffer = buffer.slice(0, -1);
        render();
        return;
      }

      if (str && !key.ctrl && !key.meta) {
        buffer += str;
        render();
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}
