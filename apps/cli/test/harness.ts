import "reflect-metadata";
import { PassThrough, Readable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { CLI } from "@mathbook/cli";
import { EventBus } from "@mathbook/common";
import { StderrLogger } from "@mathbook/hosting";
import { NotebookService, type NotebookEvent } from "@mathbook/notebook";
import { MemoryNotebookRepository } from "@mathbook/notebook/testing";
import { MathCommands } from "../src/commands/commands.js";
import type { Config } from "../src/config.js";
import { createExecutor } from "../src/commands/executor.js";

export function createHarness(
  notebook = "main",
  input: string[] = [],
  repository = new MemoryNotebookRepository(),
) {
  const out = new PassThrough();
  const err = new PassThrough();
  const cli = new CLI(Readable.from(input), out, err);
  const events = new EventBus<NotebookEvent>();
  const logs: string[] = [];
  const logger = new StderrLogger("debug", (line) => logs.push(line));
  const service = new NotebookService(
    repository,
    events,
    logger,
    () => new Date(2026, 10, 12, 10, 0, 0),
  );
  const config = {
    MATHBOOK_STORAGE: "sqlite",
    MATHBOOK_DB: ":memory:",
    MATHBOOK_MONGO_URL: "",
    MATHBOOK_NOTEBOOK: notebook,
  } satisfies Config;
  const commands = new MathCommands(cli, service, config);
  const ready = commands.start();
  const executor = createExecutor(cli, logger, commands);
  let printed = "";
  let failed = "";
  const lines = (text: string) =>
    stripVTControlCharacters(text).split("\n").slice(0, -1);
  return {
    executor,
    ready,
    repository,
    logs,
    stdout(): string[] {
      printed += out.read()?.toString() ?? "";
      return lines(printed);
    },
    stderr(): string[] {
      failed += err.read()?.toString() ?? "";
      return lines(failed);
    },
  };
}
