import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "@mathbook/common";
import type { HostedService } from "@mathbook/hosting";
import type { NotebookService } from "@mathbook/notebook";
import { handle } from "./routes.js";

/** The HTTP front end: listens when the host starts and closes when it stops. */
export class HttpService implements HostedService {
  private readonly server: Server;

  /**
   * @param service the notebook use cases the routes call.
   * @param port the TCP port to listen on; 0 picks a free one.
   * @param logger receives the start, stop and unexpected errors.
   */
  constructor(
    service: NotebookService,
    private readonly port: number,
    private readonly logger: Logger,
  ) {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        void handle(
          service,
          {
            method: request.method ?? "GET",
            url: request.url ?? "/",
            body: Buffer.concat(chunks).toString("utf8"),
          },
          (error) =>
            this.logger.error(
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
            ),
        ).then(({ status, body }) => {
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(body === undefined ? undefined : JSON.stringify(body));
        });
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, () => {
        this.server.off("error", reject);
        this.logger.info(
          `listening on http://localhost:${(this.server.address() as AddressInfo).port}`,
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) return reject(error);
        this.logger.info("stopped");
        resolve();
      });
      this.server.closeAllConnections();
    });
  }
}
