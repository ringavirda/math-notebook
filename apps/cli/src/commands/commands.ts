import { inject, injectable } from "inversify";
import { CLI, UsageError, formatCommand, type Command } from "@mathbook/cli";
import { NotebookService, StorageError } from "@mathbook/notebook";
import { CONFIG, type Config } from "../config.js";
import { formatDefinition, formatRecord, formatResult } from "./format.js";

const HISTORY_USAGE = "Usage: :history [n] [failed]";

/** The notebook app's commands and its line evaluation, printing through the CLI. */
@injectable()
export class MathCommands {
  private notebook: string;

  /** @param config names the notebook the session starts in. */
  constructor(
    private readonly cli: CLI,
    private readonly service: NotebookService,
    @inject(CONFIG) config: Config,
  ) {
    this.notebook = config.MATHBOOK_NOTEBOOK;
  }

  /** The notebook the session is in. */
  get current(): string {
    return this.notebook;
  }

  /**
   * Creates the notebook the session starts in when it does not exist.
   * @returns false when the storage failed; its message is printed as an error.
   */
  async start(): Promise<boolean> {
    try {
      await this.service.ensure(this.notebook);
      return true;
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      this.cli.echoError(error.message);
      return false;
    }
  }

  /** Runs a definition or an expression in the current notebook and prints the result. */
  async evaluate(line: string): Promise<void> {
    const result = await this.service.run(this.notebook, line);
    for (const text of formatResult(result)) this.cli.echo(text);
  }

  /** @returns the commands in the order `:help` shows them. */
  list(): Command[] {
    return [
      {
        selectors: [":help"],
        params: ["command?"],
        description: "Show the command list or one command.",
        action: (name?: string) => {
          const commands = this.list();
          if (name === undefined) {
            for (const command of commands)
              this.cli.echo(formatCommand(command));
            return;
          }
          const found = commands.find((c) =>
            c.selectors.some((s) => s === name || s === `:${name}`),
          );
          if (!found) throw new UsageError(`Unknown command: ${name}`);
          this.cli.echo(formatCommand(found));
        },
      },
      {
        selectors: [":ls"],
        params: [],
        description: "Definitions of the current notebook with values.",
        action: async () => {
          const definitions = await this.service.show(this.notebook);
          if (definitions.length === 0) this.cli.echo("Nothing defined yet.");
          for (const definition of definitions)
            this.cli.echo(formatDefinition(definition));
        },
      },
      {
        selectors: [":new"],
        params: ["name"],
        description: "Create a notebook and switch to it.",
        action: async (name: string) => {
          await this.service.create(name);
          this.notebook = name;
          this.cli.echo(`Created ${name}`);
        },
      },
      {
        selectors: [":use"],
        params: ["name"],
        description: "Switch to an existing notebook.",
        action: async (name: string) => {
          if (!(await this.service.list()).includes(name))
            throw new UsageError(
              `No notebook '${name}'; create it with :new ${name}`,
            );
          this.notebook = name;
          this.cli.echo(`Using notebook ${name}`);
        },
      },
      {
        selectors: [":notebooks"],
        params: [],
        description: "Names of the notebooks; * marks the current one.",
        action: async () => {
          const names = await this.service.list();
          for (const name of names)
            this.cli.echo(`${name === this.notebook ? "*" : " "} ${name}`);
        },
      },
      {
        selectors: [":drop"],
        params: ["name"],
        description: "Drop a notebook with its history, after asking.",
        action: async (name: string) => {
          if (name === this.notebook)
            throw new UsageError(
              `You are in ${name}; :use another notebook first`,
            );
          const count = (await this.service.show(name)).length;
          const answer = await this.cli.read(
            `Drop ${name} with ${count} definitions and its history? (y/N)`,
          );
          if (["y", "yes"].includes(answer?.trim().toLowerCase() ?? "")) {
            await this.service.drop(name);
            this.cli.echo(`Dropped ${name}`);
          } else this.cli.echo(`Kept ${name}`);
        },
      },
      {
        selectors: [":rename"],
        params: ["new"],
        description: "Rename the current notebook.",
        action: async (to: string) => {
          await this.service.rename(this.notebook, to);
          this.notebook = to;
          this.cli.echo(`Renamed to ${to}`);
        },
      },
      {
        selectors: [":clear"],
        params: [],
        description: "Empty the current notebook's history.",
        action: async () => {
          const count = await this.service.clearHistory(this.notebook);
          this.cli.echo(`Cleared ${count} evaluations`);
        },
      },
      {
        selectors: [":rm"],
        params: ["name"],
        description: "Remove a definition.",
        action: async (name: string) => {
          await this.service.remove(this.notebook, name);
          this.cli.echo(`Removed ${name}`);
        },
      },
      {
        selectors: [":deps"],
        params: ["name"],
        description: "What a definition uses and what uses it.",
        action: async (name: string) => {
          const { uses, usedBy } = await this.service.dependencies(
            this.notebook,
            name,
          );
          this.cli.echo(`uses: ${uses.join(", ") || "nothing"}`);
          this.cli.echo(`used by: ${usedBy.join(", ") || "nothing"}`);
        },
      },
      {
        selectors: [":history"],
        params: ["n?", "failed?"],
        description:
          "Last n evaluations, 10 by default; only failures with failed.",
        action: async (...words: string[]) => {
          let limit = 10;
          let failedOnly = false;
          for (const word of words) {
            if (word === "failed") failedOnly = true;
            else if (/^[1-9]\d*$/.test(word)) limit = Number(word);
            else throw new UsageError(HISTORY_USAGE);
          }
          const records = await this.service.history(this.notebook, {
            limit,
            failedOnly,
          });
          if (records.length === 0) this.cli.echo("No evaluations.");
          for (const record of records) this.cli.echo(formatRecord(record));
        },
      },
      {
        selectors: [":q"],
        params: [],
        description: "Quit; end of input does too.",
        action: () => undefined,
      },
    ];
  }
}
