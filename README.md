<img src="build/logo.svg" alt="" width="96" align="right">

# Simone

A fast desktop client for MySQL and MariaDB: the features of phpMyAdmin with an interface in the spirit of Beekeeper Studio.
Connections and saved queries live in **git repositories** ("workspaces") so a team can share them, and you can switch
between workspaces — one per client or project — from the sidebar. Passwords never leave your computer.

## Features

- **Workspaces** — clone a git repository, open a folder or create a local one; switch from the sidebar. Every change to
  a connection or a saved query is committed and pushed in the background; remote changes are pulled on switch and every
  5 minutes. Conflicts are resolved file by file ("keep mine" / "keep theirs"). Workspaces always use the `master`
  branch: a clone whose default branch is `main` is moved to `master`, and `main` is left untouched on the remote.
- **Connections** — host, port, user, default database, SSL (CA / client certificate), SSH tunnel through the system `ssh`
  (so `~/.ssh/config` aliases, `ProxyJump`, the agent and `known_hosts` all apply), environment tag with a color (production
  in red), read-only mode enforced both by the app and by the server (`SET SESSION TRANSACTION READ ONLY`). A per-user
  override of the shared user name.
- **SQL editor** — MySQL syntax highlighting, completion of keywords, tables, columns (of the tables in the statement,
  after `alias.`, and `db.table.column` in other databases, loaded on demand), run every statement or
  the selection, multiple result sets, cancel a running query (`KILL QUERY`), `EXPLAIN`, formatting,
  one dedicated connection per tab (so `USE`, variables and transactions stay on the tab), local history, tabs restored on
  reconnect.
- **Safety** — confirmation before `UPDATE` / `DELETE` without `WHERE`, `DROP`, `TRUNCATE`, and before any write on a
  production connection (typing the connection name for destructive statements).
- **Table data** — paginated browsing, column filters (`=`, `LIKE`, `IN`, `BETWEEN`, `IS NULL`…) and a raw `WHERE` with
  column completion,
  server-side sorting, inline editing with a review of the pending changes applied in one transaction, add / duplicate /
  delete rows, `NULL` values, JSON / long text / binary viewer, jump to the row referenced by a foreign key.
- **Structure** — create and alter tables (columns, types, defaults, auto increment, generated columns, collations,
  indexes, foreign keys, engine, comment) with a live preview of the DDL; views, procedures, functions, triggers and events
  (definition, edit, drop); create / drop databases, rename / copy / truncate / drop tables.
- **Import / export** — streamed SQL dumps (structure, data, routines, triggers, events), export of a table or of query
  results to CSV, JSON, Excel or SQL `INSERT`, import of SQL files (with `DELIMITER` support) and of CSV files with column
  mapping. Long jobs show their progress and can be cancelled.
- **Server** — process list with kill, global / session variables (editable), status with key metrics, users and
  privileges (create, password, grant, revoke, drop), table maintenance (analyze, check, optimize, repair).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/romainlavabre/simone/master/install.sh | bash
```

The script installs the latest release, with its entry and icon in the applications menu:

- **Debian / Ubuntu**: the `.deb` package (asks for `sudo` once). It also adds the `simone` command and the
  AppArmor profile Ubuntu 24+ needs.
- **Other distributions**: the AppImage, unpacked in `~/.local/share/simone`, without root and without FUSE.

Run it again to update. Other uses, from a checkout:

```bash
./install.sh 1.2.0           # a given version
./install.sh --file PATH     # a downloaded .deb or .AppImage
./install.sh --from-source   # build the packages here first (needs Node.js)
./install.sh --appimage      # the AppImage even on Debian / Ubuntu
./install.sh --uninstall     # remove the app; connections and passwords stay in ~/.config/simone
```

If the repository is private, log in with `gh auth login` first: the script then downloads through `gh`. The packages
can also be taken by hand from the [releases page](https://github.com/romainlavabre/simone/releases).

## Workspace repository layout

```
simone.json                    workspace name and format version (mysql-client.json before 1.1)
connections/<slug>.json        one file per connection — never any password
queries/<folder>/<name>.sql    saved queries, with their metadata in leading comments
```

A saved query is a plain SQL file, readable and reviewable in any git tool:

```sql
-- @name Monthly revenue
-- @description Paid invoices per month
-- @connection prod-db

SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, SUM(amount) FROM invoices GROUP BY month;
```

Local data (never shared) is stored in `~/.config/simone/`: the list of workspaces, the passwords (encrypted with
the system keyring through Electron `safeStorage`), per-user overrides, the query history, and the clones created by the
app (`workspaces/`).

Simone was called MySQL Client GUI until 1.0.0. On its first start it moves `~/.config/mysql-client-gui` to
`~/.config/simone`; passwords must then be typed again once, as the keyring key belongs to the former name.

## Requirements

- Linux, `git` and `openssh-client`.
- Git authentication uses your usual setup: SSH remotes use your SSH agent, HTTPS remotes your git credential helper. The
  app never prompts for git credentials.

## Development

```bash
npm install
./run.sh               # dev mode with hot reload
./run.sh --sandbox     # same, with a throwaway data folder in .sandbox/

npm run typecheck
npm run lint
npm test               # unit tests (SQL builders, splitter, git workspaces)

docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration   # MySQL 8.4 and MariaDB 11
npm run test:e2e           # Electron end-to-end test (needs the MySQL test server)
docker compose -f docker-compose.test.yml down
```

`npm run dist` builds an AppImage and a .deb in `dist/`. `./tag.sh` publishes a version (tags are plain `X.Y.Z`, without
`v`): checks, tests, packages, tag, push and GitHub release.

## Architecture

```
src/shared/     types, IPC contract, pure SQL builders (splitter, DDL, filters, row edits, privileges)
src/main/       Electron main process
  workspace/    registry of workspaces, repository files, git sync
  db/           sessions and SSH tunnels, query execution, schema introspection, data, admin, import / export
  ipc/          IPC handlers, with zod validation of every payload
src/preload/    typed bridge exposed to the renderer
src/renderer/   React interface (CodeMirror 6 editor, AG Grid tables, Tailwind)
```

The renderer has no Node access (`contextIsolation`, `sandbox`, strict CSP): all database, git and file work goes through
the IPC API defined in `src/shared/api.ts`.
