import { Container } from "inversify";
import type { Logger } from "@mathbook/common";
import { type HostedService, LOGGER } from "@mathbook/hosting";
import { HttpService, Router, mapErrors, timing } from "@mathbook/http";
import { NotebookService } from "@mathbook/notebook";
import { CONFIG, type Config } from "./config.js";
import { describeNotebookError } from "./http/errors.js";
import { addNotebookRoutes } from "./http/routes.js";

/** Token the HTTP front end is bound under in the host builder's container. */
export const HTTP_SERVICE: unique symbol = Symbol("mathbook.httpService");

/**
 * @param service the notebook use cases the routes call.
 * @param logger where timings and unexpected errors go.
 * @returns a router whose pipeline is `mapErrors`, then `timing`, around the notebook routes.
 */
export function createRouter(service: NotebookService, logger: Logger): Router {
  const router = new Router();
  router.use(mapErrors(logger, describeNotebookError));
  router.use(timing(logger));
  addNotebookRoutes(router, service);
  return router;
}

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
        new HttpService(createRouter(service, logger), config.PORT, logger),
      [NotebookService, CONFIG, LOGGER],
    )
    .inSingletonScope();
}
