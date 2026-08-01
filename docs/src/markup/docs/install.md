---
layout: poops-docs-theme/docs
title: Install
description: Four ways to run pooppress — laptop, Docker, VPS, shared hosting. All first-class.
order: 2
---

# Install

pooppress needs **Node.js 20 or newer** and nothing else. No database server, no PHP, no
build toolchain — `better-sqlite3` and `sharp` ship prebuilt binaries.

Pick the tier that fits. The same app runs in all four; only the supervision differs.

## 1. Laptop mode

Run the CMS locally, deploy only the static output. Zero hosting cost, single author.

```bash
npm install -g pooppress
mkdir my-blog && cd my-blog
pooppress init
pooppress start          # admin at http://localhost:3000/admin
```

Your whole site lives in `data/` and `themes/`. Sync that directory with Dropbox or git
and you have it on two machines.

## 2. Docker

```bash
docker build -t pooppress -f scripts/Dockerfile .

# one-time setup (interactive)
docker run -it -v $PWD/data:/app/data pooppress pooppress init

# then run it
docker run -d -p 3000:3000 \
  -v $PWD/data:/app/data \
  -v $PWD/output:/app/output \
  pooppress
```

SQLite means one volume mount. Runs on any container host — Fly, Railway, Coolify, a NAS.

## 3. VPS with systemd and HTTPS

```bash
curl -fsSL https://pooppress.dev/install.sh | sudo bash
```

The script checks for Node 20+ (installing it if missing), installs pooppress globally,
creates a dedicated non-root user, runs the setup wizard, writes a systemd unit, and
offers to install Caddy with a two-line reverse proxy:

```
cms.example.com {
    reverse_proxy localhost:3000
}
```

That is the entire HTTPS story — Caddy provisions certificates itself. Already running
nginx or Apache? Skip Caddy and point a normal vhost at `localhost:3000`.

Useful afterwards:

```bash
systemctl status pooppress
journalctl -u pooppress -f
cp -r /var/lib/pooppress /backups/    # that's the backup
```

## 4. Shared hosting (cPanel / Passenger)

Many cPanel hosts run Phusion Passenger, which spawns and supervises the Node process for
you — no systemd, no ports, no SSH daemon-wrangling.

1. Upload pooppress (or `npm install` from the panel's terminal).
2. In "Setup Node.js App", point the startup file at **`app.js`**.
3. Open the panel's terminal and run `pooppress init` once.
4. Touch `tmp/restart.txt` whenever you need a restart.

pooppress needs nothing special here: it listens on `process.env.PORT` and keeps every bit
of state in `data/`. Sessions are database rows and the build lock is a file, so Passenger
running several workers changes nothing.

Set `passenger_min_instances 1` to keep one worker warm, or the first admin hit after a
quiet spell pays a cold start.

**Known ceilings:** shared-host memory limits can choke builds on very large sites (Sass
and Sharp are the heavy parts), and Passenger idles the process. Neither affects readers —
they only ever touch the static output.

## Where things go

| Path | What | Back up? |
| --- | --- | --- |
| `data/pooppress.db` | all content and settings | yes |
| `data/uploads/` | uploaded images + variants | yes |
| `data/.env` | just `PORT` | no |
| `themes/` | installed themes | yes if customised |
| `output/` | generated site | no, it rebuilds |

`data/` is created `chmod 700` and `.env` `chmod 600`.
