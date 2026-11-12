import { Container } from "inversify";
import { CLI, Executor } from "@mathbook/cli";
import { EventBus } from "@mathbook/events";
import { LOGGER, type HostedService } from "@mathbook/host";
import type { Logger } from "@mathbook/logging";
import {
  NotebookService,
  type Clock,
  type NotebookEvent,
  type NotebookRepository,
} from "@mathbook/notebook";
import { MongoNotebookRepository } from "@mathbook/storage-mongo";
import { SqliteNotebookRepository } from "@mathbook/storage-sqlite";
import { MathCommands } from "./commands.js";
import { CONFIG, type Config } from "./config.js";
import { createExecutor } from "./executor.js";

export const EVENT_BUS: unique symbol = Symbol("mathbook.eventBus");
export const CLOCK: unique symbol = Symbol("mathbook.clock");
export const REPOSITORY: unique symbol = Symbol("mathbook.repository");
export const REPOSITORY_SERVICE: unique symbol = Symbol(
  "mathbook.repositoryService",
);

/** Opens the repository when the host starts and closes it when the host stops. */
export class RepositoryService implements HostedService {
  constructor(private readonly repository: NotebookRepository) {}

  start(): Promise<void> {
    return this.repository.open();
  }

  stop(): Promise<void> {
    return this.repository.close();
  }
}

/**
 * Binds the app's services; the host's `LOGGER` and `CONFIG` must be bound before anything is
 * resolved. Nothing is created until it is asked for.
 * @param services the host builder's container.
 */
export function addServices(services: Container): void {
  services.bind<Clock>(CLOCK).toConstantValue(() => new Date());
  services
    .bind<EventBus<NotebookEvent>>(EVENT_BUS)
    .toResolvedValue(() => new EventBus<NotebookEvent>())
    .inSingletonScope();
  services
    .bind<NotebookRepository>(REPOSITORY)
    .toResolvedValue(
      (config: Config, logger: Logger) =>
        config.MATHBOOK_STORAGE === "mongo"
          ? new MongoNotebookRepository(config.MATHBOOK_MONGO_URL, logger)
          : new SqliteNotebookRepository(config.MATHBOOK_DB, logger),
      [CONFIG, LOGGER],
    )
    .inSingletonScope();
  services
    .bind<HostedService>(REPOSITORY_SERVICE)
    .toResolvedValue(
      (repository: NotebookRepository) => new RepositoryService(repository),
      [REPOSITORY],
    )
    .inSingletonScope();
  services
    .bind(NotebookService)
    .toResolvedValue(
      (
        repository: NotebookRepository,
        events: EventBus<NotebookEvent>,
        logger: Logger,
        clock: Clock,
      ) => new NotebookService(repository, events, logger, clock),
      [REPOSITORY, EVENT_BUS, LOGGER, CLOCK],
    )
    .inSingletonScope();
  services.bind(MathCommands).toSelf().inSingletonScope();
  services
    .bind(CLI)
    .toResolvedValue(() => new CLI())
    .inSingletonScope();
  services
    .bind(Executor)
    .toResolvedValue(createExecutor, [CLI, LOGGER, MathCommands])
    .inSingletonScope();
}
