---
layout: poops-docs-theme/docs
title: Media
description: Uploads, responsive variants, and what pooppress refuses to accept.
order: 5
---

# Media

## Uploading

**Media → Upload**, or the 🖼 button in the editor toolbar, which opens the picker and
inserts `![alt](/uploads/…)` at the cursor.

Every upload is verified by *parsing* it, not by trusting its name or its declared type.
The stored filename is a generated UUID plus the extension that matches what was actually
found inside. The original filename is kept for display only — it never becomes a path.

**Accepted:** JPEG, PNG, GIF, WebP, AVIF.

**Refused:** everything else, including SVG. SVG can execute scripts, so it stays out
until a sanitizer earns its place. A `.html` renamed to `.jpg` is refused too — the parser
sees through it.

## Variants

After upload, [poops-images](https://github.com/stamat/poops-images) generates 480w, 960w
and 1600w WebP variants next to the original:

```
data/uploads/
├── 6f1e…-a2.jpg          the original
├── 6f1e…-a2-480w.webp
├── 6f1e…-a2-960w.webp
└── 6f1e…-a2-1600w.webp
```

They follow the `{name}-{width}w.{ext}` convention poops' {% raw %}`{% image %}`{% endraw %} tag discovers, so
a theme can build a `srcset` from them. The variant list is also stored on the media row.

## One path, everywhere

`data/uploads/` is served at `/uploads` by the admin server *and* copied to
`output/uploads/` by the build. So `/uploads/6f1e….jpg` resolves identically in the editor
preview and on the published site — no rewriting, no environment-specific URLs.

## Deleting

Delete removes the row, the original and every variant. The stored path is resolved and
checked to be inside `data/uploads/` before anything is unlinked — a path in a database
column is not a permission to delete a file.

Deleting media triggers a rebuild, because published pages may reference it.

## Alt text

Set it on the media item and the picker inserts it with the markdown. Alt text is
accessibility, not decoration — write it.
