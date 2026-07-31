import chalk from "chalk";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 90;

/**
 * A single-line, in-place spinner: "⠋ Thinking... 1 second". The label
 * can be swapped in real time via setLabel() while it's running (e.g.
 * to "Reading file: src/app.ts" the moment a tool actually starts),
 * and the elapsed-seconds counter keeps ticking on its own regardless
 * of how often the label changes.
 *
 * stop() clears the line completely so whatever gets printed next
 * (console.log) starts clean, with nothing left behind.
 */
export class Spinner {
  private label = "";
  private frameIndex = 0;
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(label: string): void {
    this.label = label;
    this.startTime = Date.now();
    this.frameIndex = 0;
    if (this.timer) clearInterval(this.timer);
    this.render();
    this.timer = setInterval(() => this.render(), TICK_MS);
  }

  /** Swap the label while the spinner keeps running — renders immediately, doesn't wait for the next tick. */
  setLabel(label: string): void {
    this.label = label;
    if (this.timer) this.render();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write("\r\x1b[2K"); // clear the spinner line entirely
  }

  private render(): void {
    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex++;

    const elapsedMs = Date.now() - this.startTime;
    const seconds =
      elapsedMs < 1000
        ? `${(elapsedMs / 1000).toFixed(1)} seconds`
        : `${Math.floor(elapsedMs / 1000)} second${Math.floor(elapsedMs / 1000) === 1 ? "" : "s"}`;

    const line = chalk.gray(`${frame} ${this.label}... ${seconds}`);
    process.stdout.write(`\r\x1b[2K${line}`);
  }
}

/**
 * Turns a tool call into a short human-readable activity label for the
 * spinner, e.g. read_file -> "Reading src/app.ts". Falls back to a
 * generic "Running <tool>" for anything not explicitly mapped.
 */
export function labelForTool(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : undefined;
  const url = typeof args.url === "string" ? args.url : undefined;
  const command = typeof args.command === "string" ? args.command : undefined;

  switch (name) {
    case "read_file":
      return `Reading ${path ?? "file"}`;
    case "write_file":
      return `Writing ${path ?? "file"}`;
    case "edit_file":
      return `Editing ${path ?? "file"}`;
    case "delete_file":
      return `Deleting ${path ?? "file"}`;
    case "list_dir":
      return `Reading folder ${path && path !== "." ? path : "./"}`;
    case "run_command":
      return `Running ${command ?? "command"}`;
    case "fetch_url":
      return `Fetching ${url ?? "URL"}`;
    case "install_skill":
      return "Installing skill";
    case "browser_navigate":
      return `Opening ${url ?? "page"}`;
    case "browser_screenshot":
      return "Taking screenshot";
    case "browser_evaluate":
      return "Inspecting page";
    case "browser_close":
      return "Closing browser";
    default:
      return `Running ${name}`;
  }
}
