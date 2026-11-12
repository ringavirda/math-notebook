import type { HostBuilder, HostedService } from "@mathbook/hosting";
import { LOGGER } from "@mathbook/hosting";
import { EventBus, type Logger } from "@mathbook/common";
import {
  NotebookService,
  describeEvent,
  type Clock,
  type NotebookEvent,
  type NotebookRepository,
} from "@mathbook/notebook";
import { MongoNotebookRepository } from "@mathbook/storage-mongo";
import { SqliteNotebookRepository } from "@mathbook/storage-sqlite";
import type { NotebookSettings } from "./settings.js";

export const EVENT_BUS: unique symbol = Symbol("mathbook.eventBus");
export const CLOCK: unique symbol = Symbol("mathbook.clock");
export const REPOSITORY: unique symbol = Symbol("mathbook.repository");
export const REPOSITORY_SERVICE: unique symbol = Symbol(
  "mathbook.repositoryService",
);
export const EVENT_LOG_SERVICE: unique symbol = Symbol(
  "mathbook.eventLogService",
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

/** Logs every notebook event at info level from the host's start to its stop. */
export class EventLogService implements HostedService {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly events: EventBus<NotebookEvent>,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = this.events.subscribe((event) =>
      this.logger.info(describeEvent(event)),
    );
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
  }
}

/**
 * Binds the notebook: the clock, the event bus, the repository chosen by the settings, the
 * `NotebookService` and the event logging, and registers the repository and the event logging
 * as hosted services. Nothing is created until it is asked for.
 * @param builder the host builder; `logging` must be called on it, and `configuration` with
 * `notebookSettings` (or a schema extending it) under `settingsToken`.
 * @param settingsToken the token the app's settings are bound under.
 * @returns the same builder.
 */
export function addNotebook(
  builder: HostBuilder,
  settingsToken: symbol,
): HostBuilder {
  const services = builder.services;
  services.bind<Clock>(CLOCK).toConstantValue(() => new Date());
  services
    .bind<EventBus<NotebookEvent>>(EVENT_BUS)
    .toResolvedValue(() => new EventBus<NotebookEvent>())
    .inSingletonScope();
  services
    .bind<NotebookRepository>(REPOSITORY)
    .toResolvedValue(
      (settings: NotebookSettings, logger: Logger) =>
        settings.MATHBOOK_STORAGE === "mongo"
          ? new MongoNotebookRepository(settings.MATHBOOK_MONGO_URL, logger)
          : new SqliteNotebookRepository(settings.MATHBOOK_DB, logger),
      [settingsToken, LOGGER],
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
    .bind<HostedService>(EVENT_LOG_SERVICE)
    .toResolvedValue(
      (events: EventBus<NotebookEvent>, logger: Logger) =>
        new EventLogService(events, logger),
      [EVENT_BUS, LOGGER],
    )
    .inSingletonScope();
  return builder.hosted(REPOSITORY_SERVICE).hosted(EVENT_LOG_SERVICE);
}
