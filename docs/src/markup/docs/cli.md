---
layout: poops-docs-theme/docs
title: CLI
description: Every command pooppress has.
order: 10
---

# CLI

```
pooppress <command> [options]
```

## `init`

Interactive setup wizard. Creates `data/` (mode 700), runs migrations, creates the admin
user, writes site settings, activates the default theme, adds a `Blog` collection, and
writes `data/.env` (mode 600) containing only `PORT`.

Refuses to run if the database already has users — delete `data/` to start over.

## `start`

Starts the server. Admin panel at `/admin`.

```bash
pooppress start
pooppress start --port 8080
PORT=8080 pooppress start
```

## `build`

Runs a build immediately and exits. Exits non-zero if the build failed, so cron and CI can
depend on it.

```bash
pooppress build
```

## `deploy`

Mirrors `output/` to its destination. With no flags it uses **Settings → Deploy**.

```bash
pooppress deploy
pooppress deploy --method=copy  --target=/var/www/html
pooppress deploy --method=rsync --host=me@example.com --path=/var/www/html
```

## `import`

```bash
pooppress import wxr export.xml [--collection blog] [--skip-media]
```

See [Migrating from WordPress](wordpress.html).

## Environment

| Variable | Default | What |
| --- | --- | --- |
| `PORT` | 3000 | port to listen on (Passenger sets it) |
| `POOPPRESS_ROOT` | cwd | where `data/`, `output/` and `themes/` live |
| `POOPPRESS_DATA` | `<root>/data` | database and uploads |
| `POOPPRESS_OUTPUT` | `<root>/output` | generated site |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` value — set it when behind a reverse proxy |
| `NODE_ENV` | — | `production` enables template caching |

## HTTP API

Everything the admin does is available as JSON under `/api`, using the same session
cookie: `/api/posts`, `/api/collections`, `/api/media`, `/api/themes`, `/api/settings`,
`/api/users`, `/api/build`, `/api/build/status`, `/api/auth/*`.
