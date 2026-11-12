import type { Logger } from "@mathbook/common";

export class RecordingLogger implements Logger {
  readonly lines: [string, string][] = [];

  debug(message: string): void {
    this.lines.push(["debug", message]);
  }

  info(message: string): void {
    this.lines.push(["info", message]);
  }

  warn(message: string): void {
    this.lines.push(["warn", message]);
  }

  error(message: string): void {
    this.lines.push(["error", message]);
  }
}
