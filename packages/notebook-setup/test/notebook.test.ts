import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ConfigError, createHostBuilder } from "@mathbook/hosting";
import type { EventBus } from "@mathbook/common";
import { NotebookService, type NotebookEvent } from "@mathbook/notebook";
import { MongoNotebookRepository } from "@mathbook/storage-mongo";
import { SqliteNotebookRepository } from "@mathbook/storage-sqlite";
import {
  EVENT_BUS,
  REPOSITORY,
  addNotebook,
  notebookSettings,
} from "../src/index.js";

const SETTINGS = Symbol("settings");

function builderOf(env: NodeJS.ProcessEnv, lines: string[] = []) {
  const builder = createHostBuilder({ argv: [], env })
    .configuration(SETTINGS, notebookSettings)
    .logging({ level: "info", write: (line) => lines.push(line) });
  return addNotebook(builder, SETTINGS);
}

describe("addNotebook", () => {
  it("binds a NotebookService that works on a memory database", async () => {
    const host = builderOf({ MATHBOOK_DB: ":memory:" }).build();
    const result = await host.run(async () => {
      const service = host.services.get(NotebookService);
      await service.run("main", "x = 2");
      expect(await service.run("main", "x * 3")).toMatchObject({
        kind: "expression",
        value: 6,
      });
      return 0;
    });
    expect(result).toBe(0);
  });

  it("logs the notebook events at info", async () => {
    const lines: string[] = [];
    const host = builderOf({ MATHBOOK_DB: ":memory:" }, lines).build();
    await host.run(async () => {
      await host.services.get(NotebookService).run("main", "x = 2");
      return 0;
    });
    expect(lines).toContain("[info] [main] defined x: x = 2");
  });

  it("stops logging events after the host has stopped", async () => {
    const lines: string[] = [];
    const host = builderOf({ MATHBOOK_DB: ":memory:" }, lines).build();
    await host.run(async () => 0);
    host.services.get<EventBus<NotebookEvent>>(EVENT_BUS).publish({
      type: "failed",
      notebook: "main",
      source: "x",
      stage: "domain",
      message: "late",
    });
    expect(lines).toEqual([]);
  });

  it("chooses the repository by MATHBOOK_STORAGE", () => {
    const repositoryOf = (env: NodeJS.ProcessEnv) =>
      builderOf({ MATHBOOK_DB: ":memory:", ...env })
        .build()
        .services.get(REPOSITORY);
    expect(repositoryOf({})).toBeInstanceOf(SqliteNotebookRepository);
    expect(repositoryOf({ MATHBOOK_STORAGE: "mongo" })).toBeInstanceOf(
      MongoNotebookRepository,
    );
  });

  it("fails at build on an unknown MATHBOOK_STORAGE", () => {
    expect(() => builderOf({ MATHBOOK_STORAGE: "files" }).build()).toThrow(
      ConfigError,
    );
  });
});
