import { Container } from "inversify";
import { readEnv } from "@mathbook/config";
import { StderrLogger, type Logger } from "@mathbook/logging";
import { z } from "zod";

/** Token of the `Logger` bound by `HostBuilder.logging`. */
export const LOGGER: unique symbol = Symbol("host.logger");

/** Token of the argument list (`readonly string[]`) bound in every host's services. */
export const ARGV: unique symbol = Symbol("host.argv");

/** A service the host starts before `main` and stops after it. */
export interface HostedService {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** What `createHostBuilder` reads its arguments and settings from. */
export interface HostOptions {
  /** Command line arguments without the node and script paths; `process.argv.slice(2)` when omitted. */
  argv?: readonly string[];
  /** Environment for configuration and `LOG_LEVEL`; `process.env` when omitted. */
  env?: NodeJS.ProcessEnv;
}

/** Collects configuration, services, logging and hosted services, then builds the `Host`. */
export interface HostBuilder {
  /** The container for the app's own bindings. */
  readonly services: Container;
  /**
   * Parses the environment with `schema` at `build()` and binds the result as a constant.
   * @param token the binding the parsed settings are resolved under.
   * @param schema describes the variables read, as for `readEnv`.
   */
  configuration<T>(token: symbol, schema: z.ZodType<T>): HostBuilder;
  /**
   * Binds a `Logger` under `LOGGER` at `build()`; the level comes from `LOG_LEVEL` (debug, info,
   * warn or error, default warn).
   * @param options.write receives each finished log line; stderr when omitted.
   */
  logging(options?: { write?: (line: string) => void }): HostBuilder;
  /**
   * Registers a service to start and stop with the host. Services start in the order of the
   * calls and stop in the reverse order.
   * @param token a binding in `services` whose instance is a `HostedService`.
   */
  hosted(token: symbol): HostBuilder;
  /**
   * @throws {ConfigError} when `configuration` or `LOG_LEVEL` holds a value the schema rejects.
   */
  build(): Host;
}

/** A built application: its services and the run of start, main and stop. */
export interface Host {
  readonly services: Container;
  readonly argv: readonly string[];
  /**
   * Starts the hosted services in registration order, runs `main`, then stops the started ones
   * in reverse order, also when `main` throws. While running, SIGINT stops the started
   * services in reverse and sets `process.exitCode` to 130.
   * @param main the application; its result is the exit code.
   * @returns the exit code of `main`, or 1 when a hosted service fails to start (its message
   * is written to the logger's write function or stderr after the started ones are stopped).
   * @throws whatever `main` throws, after the services are stopped.
   */
  run(main: (host: Host) => Promise<number>): Promise<number>;
}

const levelSchema = z.object({
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("warn"),
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Creates a builder for an application host.
 * @param options argument list and environment; the process's own when omitted.
 */
export function createHostBuilder(options: HostOptions = {}): HostBuilder {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const services = new Container();
  services.bind<readonly string[]>(ARGV).toConstantValue(argv);

  const settings: { token: symbol; schema: z.ZodType }[] = [];
  const hostedTokens: symbol[] = [];
  let logging: { write?: (line: string) => void } | undefined;

  const builder: HostBuilder = {
    services,
    configuration(token, schema) {
      settings.push({ token, schema });
      return builder;
    },
    logging(loggingOptions = {}) {
      logging = loggingOptions;
      return builder;
    },
    hosted(token) {
      hostedTokens.push(token);
      return builder;
    },
    build() {
      for (const { token, schema } of settings) {
        services.bind(token).toConstantValue(readEnv(schema, env));
      }
      let write: ((line: string) => void) | undefined;
      if (logging) {
        write = logging.write;
        const { LOG_LEVEL } = readEnv(levelSchema, env);
        services
          .bind<Logger>(LOGGER)
          .toConstantValue(new StderrLogger(LOG_LEVEL, write));
      }
      return new AppHost(services, argv, hostedTokens, write);
    },
  };
  return builder;
}

class AppHost implements Host {
  constructor(
    readonly services: Container,
    readonly argv: readonly string[],
    private readonly hostedTokens: readonly symbol[],
    private readonly write?: (line: string) => void,
  ) {}

  async run(main: (host: Host) => Promise<number>): Promise<number> {
    const started: HostedService[] = [];
    let stopping: Promise<void> | undefined;
    const stopAll = (): Promise<void> => {
      stopping ??= (async () => {
        for (const service of started.reverse()) await service.stop();
      })();
      return stopping;
    };
    const onSigint = (): void => {
      process.exitCode = 130;
      void stopAll();
    };
    process.on("SIGINT", onSigint);
    try {
      for (const token of this.hostedTokens) {
        const service = this.services.get<HostedService>(token);
        try {
          await service.start();
        } catch (error) {
          await stopAll();
          const line = messageOf(error);
          if (this.write) this.write(line);
          else process.stderr.write(line + "\n");
          return 1;
        }
        started.push(service);
      }
      return await main(this);
    } finally {
      await stopAll();
      process.off("SIGINT", onSigint);
    }
  }
}
