# math-notebook

A notebook for arithmetic, in the terminal or over HTTP. Type expressions (`1 + 2`) and definitions
(`price = 40`, `total(n) = n * price`); the notebook keeps the definitions, recomputes the ones
that depend on a changed value and remembers every evaluation. It is the example app of lesson 5:
a small interpreter, a domain layer, two storages (SQLite and MongoDB) and the app infrastructure
around them, each in its own package.

## Layout

- `apps/cli` the app: `main.ts` builds the host, `services.ts` binds the command line, `app.ts` runs it,
  `executor.ts` runs one line, `commands.ts` holds the commands, `format.ts` the output.
- `apps/api` the same libraries behind HTTP on `node:http`: `routes.ts` maps requests to the
  notebook service, `server.ts` is the hosted service, `services.ts` binds it,
  `requests.http` holds the requests to send.
- `packages/interpreter` lexer, parser, analyzer and evaluator of the language, with errors that
  carry the span of the input they come from.
- `packages/notebook` the domain: notebooks, dependencies, the service, events and the repository
  port.
- `packages/storage-sqlite` the repository on SQLite through Drizzle, with migrations.
- `packages/storage-mongo` the repository on MongoDB through the driver.
- `packages/notebook-setup` `addNotebook`, the wiring both apps share: clock, event bus, the chosen
  repository, the service and the event logging, with the settings they read.
- `packages/hosting` the application host: configuration, the stderr logger, hosted services, start and stop.
- `packages/cli` terminal input and output, the command executor with its middleware, one-shot
  and interactive modes.
- `packages/common` the typed event bus, the logger interface and the `logged` method decorator.

## Commands

    pnpm install --frozen-lockfile
    pnpm -r build
    pnpm lint
    pnpm -r typecheck
    pnpm -r test

    pnpm --filter @mathbook/cli-app start              interactive session
    pnpm --filter @mathbook/cli-app start '1 + 2'      one line, exit code 0, 1 (failed) or 2 (used wrongly)
    pnpm --filter @mathbook/cli-app dev                rebuild and restart on change
    pnpm --filter @mathbook/cli-app start < seed.txt   fill the notebooks with examples, into a fresh database

    pnpm --filter @mathbook/api start                  HTTP API on PORT, default 3000, until Ctrl+C
    pnpm --filter @mathbook/api dev                    rebuild and restart on change

A line starting with `:` is a command, any other line is evaluated. A session creates its start
notebook (`MATHBOOK_NOTEBOOK`) when it is missing; any other notebook is made with `:new`. The
prompt shows the current notebook.

    :help [command]       commands
    :ls                   definitions of the current notebook with values
    :new <name>           create a notebook and switch to it
    :use <name>           switch to an existing notebook
    :notebooks            notebook names, * marks the current one
    :drop <name>          drop a notebook and its history, after asking (not the current one)
    :rename <new>         rename the current notebook
    :clear                empty the current notebook's history
    :rm <name>            remove a definition
    :deps <name>          what it uses and what uses it
    :history [n] [failed] last n evaluations (default 10)
    :q                    quit (also end of input)

## Environment

| Variable             | Default                              | Meaning                               |
| -------------------- | ------------------------------------ | ------------------------------------- |
| `MATHBOOK_STORAGE`   | `sqlite`                             | `sqlite` or `mongo`                   |
| `MATHBOOK_DB`        | `data/notebook.db`                   | SQLite file, or `:memory:`            |
| `MATHBOOK_MONGO_URL` | `mongodb://localhost:27017/mathbook` | MongoDB URL; the path is the database |
| `MATHBOOK_NOTEBOOK`  | `main`                               | notebook a session starts in          |
| `PORT`               | `3000`                               | port of the API (`apps/api` only)     |
| `LOG_LEVEL`          | `warn`, `info` for `apps/api`        | `debug`, `info`, `warn` or `error`    |

At `info` every definition, recomputation, removal and evaluation is logged; at `debug` also each SQL statement or MongoDB command and the
time of each call.

## API

Start it with `pnpm --filter @mathbook/api start`, install the recommended VS Code extension
REST Client, open `apps/api/requests.http` and click Send Request over a request. The API shares
the SQLite file with the CLI, so a value defined over HTTP is read by `pnpm --filter
@mathbook/cli-app start 'price * 3'`.

    GET    /notebooks                                  names
    POST   /notebooks                                  body {"name": "shop"}, 201
    PATCH  /notebooks/:name                            body {"name": "store"}, renames
    DELETE /notebooks/:name                            204, with its definitions and history
    DELETE /notebooks/:name/history                    204
    GET    /notebooks/:name                            definitions with values
    POST   /notebooks/:name/run                        body {"line": "price = 40"}
    DELETE /notebooks/:name/definitions/:def           204
    GET    /notebooks/:name/dependencies/:def          uses and usedBy
    GET    /notebooks/:name/history?limit=10&failed    evaluations, newest first

Errors are JSON `{"error": {"stage", "message"}}`: 400 for a line that fails an interpreter stage
(with its `span`) or a bad request, 404 for an unknown notebook, definition or route, 409 for a refused definition or removal (something depends on it) or a taken name, 400 with stage `domain` for an invalid notebook name, 413 for a body over 64 KiB,
500 `Unexpected error` for anything else.

## MongoDB

    docker compose up -d
    MATHBOOK_STORAGE=mongo pnpm --filter @mathbook/cli-app start ':ls'

The tests of `packages/storage-mongo` and `apps/cli` start their own in-memory MongoDB and need no
container.
