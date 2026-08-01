---
layout: poops-docs-theme/docs
title: Security
description: Platform primitives, zero security dependencies, and one very large free win.
order: 11
---

# Security

## The free part

The public site is static files. Nothing executes between a reader and the HTML, so the
reader-facing attack surface belongs to your static host, not to pooppress. No SQL
injection, no PHP object injection, no vulnerable plugin in the request path — because
there is no request path.

Everything below hardens the **admin server**, which only authors touch, and which often
isn't public at all.

## What's wired on

**Sessions.** A 32-byte random token in the cookie; the database stores only its SHA-256.
A leaked database copy contains no usable sessions. Cookies are `HttpOnly`, `SameSite=Lax`
and `Secure` behind TLS, with a 14-day sliding expiry. Logging out deletes the row — real
server-side revocation. Changing a password deletes that user's other sessions.

**Passwords.** scrypt from `node:crypto` (`N=2¹⁵, r=8, p=1`, 16-byte salt, 64-byte key),
stored self-describing so the parameters can be raised later without a flag day, compared
with `timingSafeEqual`.

**Login.** Wrong password and unknown email produce the identical message, and an unknown
email still pays for a hash so response timing can't enumerate users. Ten failures per
15 minutes per IP+email earn a 429.

**CSRF.** Two independent layers and no token machinery: `SameSite=Lax` keeps the cookie
off cross-site writes, and a state-changing request whose `Origin` disagrees with the
site's is refused. Corollary, enforced in review: GET handlers never mutate.

**XSS.** Nunjucks autoescaping is on for every admin template. The admin sends
`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: same-origin`.

**Uploads.** Allowlisted formats only (JPEG, PNG, GIF, WebP, AVIF), verified by parsing
the file rather than trusting its name; stored under generated names; size-capped. No SVG.

**Paths.** Slugs are validated against `^[a-z0-9][a-z0-9-]*$` server-side because they
become file paths. Media deletion resolves the path and refuses anything outside
`data/uploads/`.

**SQL.** Prepared statements with bound parameters, always. `LIKE` input has its wildcards
escaped.

Zero security dependencies. All of it is what the platform already ships.

## Documented ceilings

Honest limits, written down rather than hidden:

- The login rate limit is an in-process window. Under Passenger with N workers, N × the
  rate gets through. Move it into SQLite if distributed abuse ever shows up.
- The admin CSP allows `'unsafe-eval'` (stock Alpine needs it) and `'unsafe-inline'` for
  styles (CodeMirror and Alpine write style attributes). Alpine's CSP build would drop
  the first.
- Themes and any future plugins are code running with the process's rights. Same trust
  model as WordPress, stated plainly: install what you trust.

## Running it safely

- Put the admin behind TLS (Caddy does it in two lines) and set `TRUST_PROXY` so `Secure`
  cookies and client IPs survive the proxy hop.
- Better still, don't expose it: laptop mode, a VPN, or localhost-only binding.
- Back up `data/` — that is the entire site.
- Give people the smallest role that works: **author** (own posts), **editor** (all
  content), **admin** (everything).
