import * as readline from "readline";
import chalk from "chalk";
import { Skill } from "./skills";

/**
 * Same look as the model/provider picker in modelPicker.ts:
 *
 * Skills                                              esc
 *
 * ▎search...
 *
 * Installed
 *   pdf-tools
 *   data-analysis   <- solid orange highlight when selected via ↑↓
 *
 * If nothing is installed yet, shows "Not skills yet" instead of a list,
 * and ↑↓ / Enter do nothing since there's nothing to select.
 *
 * Returns the selected Skill, or null if the user cancels (esc) or there
 * was nothing to select.
 */
export function selectSkill(skills: Skill[]): Promise<Skill | null> {
  return new Promise((resolve) => {
    let query = "";
    let selectedIndex = 0;
    let scrollOffset = 0;
    const VISIBLE_ROWS = 5;
    let previousRowCount = 0;

    const width = Math.min(process.stdout.columns || 80, 60);
    const purple = chalk.hex("#b19cd9");
    const orange = chalk.hex("#e0a165");
    const orangeBg = chalk.bgHex("#e0a165").black.bold;

    const rowsForLine = (line: string): number =>
      Math.max(1, Math.ceil(line.replace(/\x1b\[[0-9;]*m/g, "").length / width));

    const padRight = (text: string, len: number): string => {
      const visLen = text.replace(/\x1b\[[0-9;]*m/g, "").length;
      return visLen < len ? text + " ".repeat(len - visLen) : text;
    };

    const getFiltered = (): Skill[] => {
      const q = query.trim().toLowerCase();
      if (!q) return skills;
      return skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    };

    const buildLines = (): string[] => {
      const filtered = getFiltered();
      if (selectedIndex >= filtered.length)
        selectedIndex = Math.max(0, filtered.length - 1);

      const lines: string[] = [];

      const headerLeft = chalk.bold.white("Skills");
      const headerRight = chalk.gray("esc");
      const headerPad = Math.max(1, width - "Skills".length - "esc".length);
      lines.push(headerLeft + " ".repeat(headerPad) + headerRight);
      lines.push("");

      if (skills.length === 0) {
        lines.push(chalk.gray("Not skills yet"));
        lines.push("");
        lines.push(chalk.gray("Use /install <link> to install one"));
        return lines;
      }

      const cursorBar = orange("▎");
      const searchText = query.length ? query : chalk.gray("search...");
      lines.push(cursorBar + searchText);
      lines.push("");

      lines.push(purple("Installed"));

      if (filtered.length === 0) {
        lines.push(chalk.gray("  No results match your search"));
      } else {
        if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
        if (selectedIndex >= scrollOffset + VISIBLE_ROWS)
          scrollOffset = selectedIndex - VISIBLE_ROWS + 1;
        scrollOffset = Math.max(
          0,
          Math.min(scrollOffset, Math.max(0, filtered.length - VISIBLE_ROWS))
        );

        if (scrollOffset > 0) lines.push(chalk.gray(`  ↑ ${scrollOffset} more`));

        const visible = filtered.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
        visible.forEach((skill, vi) => {
          const i = scrollOffset + vi;
          const isSelected = i === selectedIndex;
          const label = "  " + skill.command;

          if (isSelected) {
            lines.push(orangeBg(padRight(label, width)));
          } else {
            lines.push(chalk.white(label));
          }
        });

        const remaining = filtered.length - (scrollOffset + visible.length);
        if (remaining > 0) lines.push(chalk.gray(`  ↓ ${remaining} more`));

        const current = filtered[selectedIndex];
        if (current) {
          lines.push("");
          lines.push(chalk.gray("  " + current.description));
        }
      }

      return lines;
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

    const eraseBox = () => {
      if (previousRowCount > 0) {
        process.stdout.write(`\x1b[${previousRowCount}A`);
        process.stdout.write("\x1b[G\x1b[J");
      }
      previousRowCount = 0;
    };

    render();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdout.write("\x1b[?25l");

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?25h");
    };

    const onKeypress = (str: string, key: readline.Key) => {
      const filtered = getFiltered();

      if (key.ctrl && key.name === "c") {
        eraseBox();
        cleanup();
        process.exit(0);
      }

      if (key.name === "escape") {
        eraseBox();
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return") {
        eraseBox();
        cleanup();
        resolve(filtered[selectedIndex] ?? null);
        return;
      }

      if (skills.length === 0) return; // nothing else to do on an empty list

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
        render();
        return;
      }

      if (key.name === "backspace") {
        query = query.slice(0, -1);
        selectedIndex = 0;
        render();
        return;
      }

      if (str && !key.ctrl && !key.meta) {
        query += str;
        selectedIndex = 0;
        render();
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}
