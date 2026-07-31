import * as readline from "readline";
import chalk from "chalk";

interface Item {
  id: string;
  name: string;
}

interface PickerOptions {
  title: string; // top-left header text, e.g. "Nbref" or "OpenRouter"
  category: string; // purple category label above the list
  currentId?: string; // marks one item with an orange dot as "current"
}

/**
 * Generic searchable, arrow-key navigable picker used for both the
 * provider menu and the per-provider model menu:
 *
 * Nbref                                              esc
 *
 * ▎search...
 *
 * Nbref
 * ● Claude Opus 4.5 Thinking
 *   Claude Sonnet
 *   Gemini 1.5 Flash-8B   <- solid orange highlight when selected via ↑↓
 *
 * Connect provider          Favorite
 * ctrl+a                    ctrl+f
 *
 * Returns the selected item, or null if the user cancels (esc).
 */
function selectFromList<T extends Item>(
  items: T[],
  options: PickerOptions
): Promise<T | null> {
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

    const getFiltered = (): T[] => {
      const q = query.trim().toLowerCase();
      if (!q) return items;
      return items.filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
      );
    };

    const padRight = (text: string, len: number): string => {
      const visLen = text.replace(/\x1b\[[0-9;]*m/g, "").length;
      return visLen < len ? text + " ".repeat(len - visLen) : text;
    };

    // same wrapping-aware row count used by inputbox.ts, needed so the
    // cursor moves up exactly as many terminal rows as the previous
    // render actually occupied, regardless of scrolling
    const rowsForLine = (line: string): number =>
      Math.max(1, Math.ceil(line.replace(/\x1b\[[0-9;]*m/g, "").length / width));

    const buildLines = (): string[] => {
      const filtered = getFiltered();
      if (selectedIndex >= filtered.length)
        selectedIndex = Math.max(0, filtered.length - 1);

      const lines: string[] = [];

      const headerLeft = chalk.bold.white(options.title);
      const headerRight = chalk.gray("esc");
      const headerPad = Math.max(
        1,
        width - options.title.length - "esc".length
      );
      lines.push(headerLeft + " ".repeat(headerPad) + headerRight);
      lines.push("");

      const cursorBar = orange("▎");
      const searchText = query.length ? query : chalk.gray("search...");
      lines.push(cursorBar + searchText);
      lines.push("");

      lines.push(purple(options.category));

      if (filtered.length === 0) {
        lines.push(chalk.gray("  No results match your search"));
      } else {
        // keep the selected item inside a fixed-height scroll window
        // instead of dumping the whole (now much longer) model list
        if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
        if (selectedIndex >= scrollOffset + VISIBLE_ROWS)
          scrollOffset = selectedIndex - VISIBLE_ROWS + 1;
        scrollOffset = Math.max(
          0,
          Math.min(scrollOffset, Math.max(0, filtered.length - VISIBLE_ROWS))
        );

        if (scrollOffset > 0) {
          lines.push(chalk.gray(`  ↑ ${scrollOffset} more`));
        }

        const visible = filtered.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
        visible.forEach((item, vi) => {
          const i = scrollOffset + vi;
          const isSelected = i === selectedIndex;
          const isCurrent = item.id === options.currentId;
          const dot = isCurrent ? orange("● ") : "  ";
          const label = dot + item.name;

          if (isSelected) {
            lines.push(orangeBg(padRight(label, width)));
          } else {
            lines.push(isCurrent ? orange(label) : chalk.white(label));
          }
        });

        const remaining = filtered.length - (scrollOffset + visible.length);
        if (remaining > 0) {
          lines.push(chalk.gray(`  ↓ ${remaining} more`));
        }
      }

      lines.push("");
      lines.push("");

      const col1 = "Connect provider";
      const col2 = "Favorite";
      const colWidth = Math.floor(width / 2);
      lines.push(
        chalk.bold.white(padRight(col1, colWidth)) + chalk.bold.white(col2)
      );
      lines.push(
        chalk.gray(padRight("ctrl+a", colWidth)) + chalk.gray("ctrl+f")
      );

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

export function selectProvider<T extends Item>(
  providers: T[],
  currentId?: string
): Promise<T | null> {
  return selectFromList(providers, {
    title: "Nbref",
    category: "Providers",
    currentId,
  });
}

export function selectModel<T extends Item>(
  models: T[],
  providerName: string,
  currentId?: string
): Promise<T | null> {
  return selectFromList(models, {
    title: providerName,
    category: providerName,
    currentId,
  });
}
