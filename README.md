# math-notebook

A notebook for arithmetic in the terminal. Type expressions (`1 + 2`) and definitions
(`price = 40`, `total(n) = n * price`); the notebook keeps the definitions, recomputes the ones
that depend on a changed value and remembers every evaluation. It is the example app of lesson 5:
a small interpreter, a domain layer, two storages (SQLite and MongoDB) and the app infrastructure
around them, each in its own package.

## Layout

- `apps/cli` the app: `main.ts` builds the host, `services.ts` binds the services, `commands.ts`
  holds the commands, `format.ts` the output.
- `packages/interpreter` lexer, parser, analyzer and evaluator of the language, with errors that
  carry the span of the input they come from.
- `packages/notebook` the domain: notebooks, dependencies, the service, events and the repository
  port.
- `packages/storage-sqlite` the repository on SQLite through Drizzle, with migrations.
- `packages/storage-mongo` the repository on MongoDB through the driver.
- `packages/host` the application host: configuration, logging, hosted services, start and stop.
- `packages/cli` terminal input and output, the command executor with its middleware, one-shot
  and interactive modes.
- `packages/config` reads and validates environment variables.
- `packages/logging` the logger and the `logged` method decorator.
- `packages/events` the typed event bus.

## Commands

    pnpm install --frozen-lockfile
    pnpm -r build
    pnpm lint
    pnpm -r typecheck
    pnpm -r test

    pnpm --filter @mathbook/cli-app start              interactive session
    pnpm --filter @mathbook/cli-app start '1 + 2'      one line, exit code 0, 1 (failed) or 2 (used wrongly)
    pnpm --filter @mathbook/cli-app dev                rebuild and restart on change

A line starting with `:` is a command, any other line is evaluated.

    :help [command]       commands
    :ls                   definitions of the current notebook with values
    :use <name>           switch notebook (created on first save)
    :notebooks            notebook names
    :rm <name>            remove a definition
    :deps <name>          what it uses and what uses it
    :history [n] [failed] last n evaluations (default 10)
    :q                    quit (also end of input)

## Environment

| Variable             | Default                              | Meaning                               |
| -------------------- | ------------------------------------ | ------------------------------------- |
| `MATHBOOK_STORAGE`   | `sqlite`                             | `sqlite` or `mongo`                   |
| `MATHBOOK_DB`        | `apps/cli/data/notebook.db`          | SQLite file, or `:memory:`            |
| `MATHBOOK_MONGO_URL` | `mongodb://localhost:27017/mathbook` | MongoDB URL; the path is the database |
| `MATHBOOK_NOTEBOOK`  | `main`                               | notebook a session starts in          |
| `LOG_LEVEL`          | `warn`                               | `debug`, `info`, `warn` or `error`    |

At `info` every change is logged; at `debug` also each SQL statement or MongoDB command and the
time of each call.

## MongoDB

    docker compose up -d
    MATHBOOK_STORAGE=mongo pnpm --filter @mathbook/cli-app start ':ls'

The tests of `packages/storage-mongo` and `apps/cli` start their own in-memory MongoDB and need no
container.
