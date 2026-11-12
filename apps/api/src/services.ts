import { Container } from "inversify";
import type { Logger } from "@mathbook/common";
import { type HostedService, LOGGER } from "@mathbook/hosting";
import { NotebookService } from "@mathbook/notebook";
import { CONFIG, type Config } from "./config.js";
import { HttpService } from "./http/server.js";

/** Token the HTTP front end is bound under in the host builder's container. */
export const HTTP_SERVICE: unique symbol = Symbol("mathbook.httpService");

/**
 * Binds the HTTP front end; the host's `LOGGER` and `CONFIG` and the notebook's bindings must
 * be bound before anything is resolved. Nothing is created until it is asked for.
 * @param services the host builder's container.
 */
export function addServices(services: Container): void {
  services
    .bind<HostedService>(HTTP_SERVICE)
    .toResolvedValue(
      (service: NotebookService, config: Config, logger: Logger) =>
        new HttpService(service, config.PORT, logger),
      [NotebookService, CONFIG, LOGGER],
    )
    .inSingletonScope();
}
