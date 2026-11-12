import {
  createServer,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "@mathbook/common";
import type { HostedService } from "@mathbook/hosting";
import type { NotebookService } from "@mathbook/notebook";
import { handle, type Reply } from "./routes.js";

const MAX_BODY_BYTES = 64 * 1024;

function send(
  response: ServerResponse,
  { status, body }: Reply,
  headers: OutgoingHttpHeaders = {},
): void {
  if (body === undefined) {
    response.writeHead(status, headers);
    return void response.end();
  }
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(text);
}

/**
 * The HTTP front end: listens when the host starts and closes when it stops, letting requests in
 * flight finish. A body over 64 KiB answers 413 with `Connection: close`, and the socket closes
 * after the answer.
 */
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
      let size = 0;
      let tooLarge = false;
      request.on("data", (chunk: Buffer) => {
        if (tooLarge) return;
        size += chunk.length;
        if (size <= MAX_BODY_BYTES) return void chunks.push(chunk);
        tooLarge = true;
        chunks.length = 0;
        send(
          response,
          {
            status: 413,
            body: {
              error: {
                stage: "request",
                message: `Body is over ${MAX_BODY_BYTES} bytes`,
              },
            },
          },
          { Connection: "close" },
        );
      });
      request.on("end", () => {
        if (tooLarge) return;
        handle(
          service,
          {
            method: request.method ?? "GET",
            url: request.url ?? "/",
            body: Buffer.concat(chunks).toString("utf8"),
          },
          (error) => this.logError(error),
        )
          .then((reply) => send(response, reply))
          .catch((error: unknown) => {
            this.logError(error);
            if (response.headersSent) return response.destroy();
            send(response, {
              status: 500,
              body: { error: { stage: "server", message: "Unexpected error" } },
            });
          });
      });
    });
  }

  private logError(error: unknown): void {
    this.logger.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
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
    });
  }
}
