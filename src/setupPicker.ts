import chalk from "chalk";
import * as readline from "readline";

export type SetupChoice = "apikey" | "key";

interface SetupOption {
  id: SetupChoice;
  label: string;
}

const OPTIONS: SetupOption[] = [
  { id: "apikey", label: "ApiKey" },
  { id: "key", label: "Key" },
];

/**
 * Renders the very first screen shown on `tsx app.ts`:
 *
 * > Please select the Nbref CLI for initial setup
 *
 * Select to enter your API
 * ❯ 1.ApiKey
 *   2.Key
 *
 * ↑↓ navigate, Enter to confirm. Resolves with the chosen option's id.
 */
export function selectSetupOption(): Promise<SetupChoice> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let previousRowCount = 0;
    const width = Math.min(process.stdout.columns || 80, 100);

    const rowsForLine = (line: string): number =>
      Math.max(1, Math.ceil(line.replace(/\x1b\[[0-9;]*m/g, "").length / width));

    const buildLines = (): string[] => {
      const lines: string[] = [];
      lines.push(
        chalk.bold.white("> Please select the Nbref CLI for initial setup")
      );
      lines.push("");
      lines.push(chalk.bold.white("Select to enter your API"));

      OPTIONS.forEach((opt, i) => {
        const isSelected = i === selectedIndex;
        const text = `${i + 1}.${opt.label}`;
        lines.push(
          isSelected
            ? chalk.bold.white(`❯ ${text}`)
            : chalk.gray(`  ${text}`)
        );
      });

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
      if (key.ctrl && key.name === "c") {
        eraseBox();
        cleanup();
        process.exit(0);
      }

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = Math.min(OPTIONS.length - 1, selectedIndex + 1);
        render();
        return;
      }

      if (key.name === "return") {
        eraseBox();
        cleanup();
        resolve(OPTIONS[selectedIndex].id);
        return;
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}
