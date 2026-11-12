import { Container } from "inversify";
import { EventBus, type Logger } from "@mathbook/common";
import { type HostedService, LOGGER } from "@mathbook/hosting";
import {
  NotebookService,
  type Clock,
  type NotebookEvent,
  type NotebookRepository,
} from "@mathbook/notebook";
import { MongoNotebookRepository } from "@mathbook/storage-mongo";
import { SqliteNotebookRepository } from "@mathbook/storage-sqlite";
import { CONFIG, type Config } from "./config.js";
import { HttpService } from "./server.js";

export const EVENT_BUS: unique symbol = Symbol("mathbook.eventBus");
export const CLOCK: unique symbol = Symbol("mathbook.clock");
export const REPOSITORY: unique symbol = Symbol("mathbook.repository");
export const REPOSITORY_SERVICE: unique symbol = Symbol(
  "mathbook.repositoryService",
);
export const HTTP_SERVICE: unique symbol = Symbol("mathbook.httpService");

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
  services
    .bind<HostedService>(HTTP_SERVICE)
    .toResolvedValue(
      (service: NotebookService, config: Config, logger: Logger) =>
        new HttpService(service, config.PORT, logger),
      [NotebookService, CONFIG, LOGGER],
    )
    .inSingletonScope();
}
