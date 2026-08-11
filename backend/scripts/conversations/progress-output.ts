import type { ConversationProgress } from "./progress.js";

const LIVE_REFRESH_MS = 1_000;

/**
 * Owns the single live progress line shown on a TTY while scenarios run in
 * parallel. Any other console output (for example model-retry warnings)
 * clears the live line first, writes its own line, and then redraws the live
 * line, so progress and ETA stay readable instead of being mangled together.
 */
export class LiveProgressRenderer {
  private readonly isTty: boolean;
  private liveVisible = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly restoreConsoles: () => void;

  constructor(private readonly progress: ConversationProgress) {
    this.isTty = process.stdout.isTTY === true;
    this.restoreConsoles = this.isTty ? this.wrapConsoles() : (): void => undefined;
  }

  start(): void {
    if (this.isTty) {
      this.timer = setInterval(() => this.render(), LIVE_REFRESH_MS);
    }
  }

  render(): void {
    if (this.isTty) {
      process.stdout.write(`\r\x1b[K${this.progress.line()}`);
      this.liveVisible = true;
    } else {
      console.log(this.progress.line());
    }
  }

  commit(line: string): void {
    if (this.isTty) {
      process.stdout.write(`\r\x1b[K${line}\n`);
      this.liveVisible = false;
    } else {
      console.log(line);
    }
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.restoreConsoles();
  }

  private clearLive(): void {
    if (this.isTty && this.liveVisible) {
      process.stdout.write("\r\x1b[K");
      this.liveVisible = false;
    }
  }

  private wrapConsole(method: (...args: unknown[]) => void): (...args: unknown[]) => void {
    return (...args: unknown[]): void => {
      const wasVisible = this.liveVisible;
      this.clearLive();
      method(...args);
      if (wasVisible) this.render();
    };
  }

  private wrapConsoles(): () => void {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;
    console.log = this.wrapConsole(originalLog);
    console.warn = this.wrapConsole(originalWarn);
    console.error = this.wrapConsole(originalError);
    console.info = this.wrapConsole(originalInfo);
    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
    };
  }
}
