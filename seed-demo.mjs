// One-off demo seeder: generates placeholder images, seeds pages + blog posts,
// rebuilds the site. Safe to rerun — skips slugs that already exist.
import sharp from 'sharp'
import { storeUpload } from './server/media.js'
import { posts, media, collections, settings } from './server/queries.js'
import { sql } from './server/db.js'

const AUTHOR_ID = 1
const BLOG_ID = 1

// Muted abstract placeholders, 1600x900, rendered from SVG.
const IMAGES = [
  ['dunes', '#e8e4dc', '#c9beab', 'Soft dunes under a pale sky', `<path d="M0 620 Q 400 500 800 610 T 1600 580 V900 H0 Z" fill="#c9beab"/><path d="M0 720 Q 500 640 1000 730 T 1600 700 V900 H0 Z" fill="#b3a68f" opacity="0.8"/><circle cx="1250" cy="230" r="90" fill="#d9d2c4"/>`],
  ['tide', '#dde4e6', '#9fb4bc', 'Tide lines on a grey shore', `<path d="M0 500 Q 800 560 1600 480 V900 H0 Z" fill="#b8c8cd"/><path d="M0 640 Q 800 700 1600 620 V900 H0 Z" fill="#9fb4bc"/><path d="M0 780 Q 800 830 1600 760 V900 H0 Z" fill="#87a0aa"/>`],
  ['field', '#e6e8e0', '#a8b39a', 'A quiet field at dusk', `<rect y="560" width="1600" height="340" fill="#a8b39a"/><rect y="560" width="1600" height="8" fill="#8d9a7e"/><circle cx="380" cy="300" r="110" fill="#d6d9cc"/><rect x="1100" y="430" width="6" height="130" fill="#8d9a7e"/><rect x="1180" y="460" width="6" height="100" fill="#8d9a7e"/>`],
  ['stones', '#e7e3e0', '#b0a49c', 'Stacked stones in afternoon light', `<ellipse cx="800" cy="720" rx="260" ry="70" fill="#b0a49c"/><ellipse cx="800" cy="600" rx="200" ry="60" fill="#9c8f86"/><ellipse cx="800" cy="500" rx="140" ry="50" fill="#b0a49c"/><ellipse cx="800" cy="420" rx="90" ry="38" fill="#877a71"/>`],
  ['window', '#e2e2e6', '#a3a3b0', 'Light falling through a tall window', `<rect x="560" y="120" width="480" height="660" fill="#c8c8d2"/><rect x="560" y="120" width="230" height="660" fill="#d6d6de"/><rect x="795" y="120" width="10" height="660" fill="#a3a3b0"/><rect x="560" y="440" width="480" height="10" fill="#a3a3b0"/>`],
  ['grid', '#e9e6e2', '#b5aa9d', 'A weathered tiled wall', `${Array.from({ length: 24 }, (_, i) => `<rect x="${(i % 6) * 270 + 20}" y="${Math.floor(i / 6) * 230 + 20}" width="250" height="210" fill="${['#ddd5c9', '#cfc5b6', '#c4b8a7'][i % 3]}" rx="4"/>`).join('')}`],
  ['path', '#e4e7e2', '#9aa694', 'A gravel path between hedges', `<path d="M700 900 L780 300 L820 300 L900 900 Z" fill="#cfc9bd"/><rect y="260" width="640" height="640" x="0" fill="#9aa694"/><rect y="260" width="640" height="640" x="960" fill="#8f9c89"/>`],
  ['harbor', '#dfe4e8', '#94a6b5', 'Masts in a still harbor', `<rect y="600" width="1600" height="300" fill="#94a6b5"/><rect x="400" y="180" width="8" height="420" fill="#6f8496"/><rect x="700" y="120" width="8" height="480" fill="#6f8496"/><rect x="1100" y="220" width="8" height="380" fill="#6f8496"/><ellipse cx="750" cy="640" rx="500" ry="18" fill="#879aa9" opacity="0.6"/>`]
]

async function makeImage([name, from, to, alt, shapes]) {
  const existing = sql('SELECT path FROM media WHERE original_name = ?').get(`${name}.jpg`)
  if (existing) return { alt, url: `/${existing.path}` }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="1600" height="900" fill="url(#g)"/>${shapes}</svg>`
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer()
  const stored = await storeUpload(buffer, `${name}.jpg`, AUTHOR_ID)
  const row = media.create({ ...stored, alt_text: alt })
  return { alt, url: `/${row.path}` }
}

const img = {}
for (const spec of IMAGES) {
  img[spec[0]] = await makeImage(spec)
  console.log(`image: ${spec[0]}`)
}
const md = (name) => `![${img[name].alt}](${img[name].url})`

const PAGES = [
  {
    slug: 'index',
    title: 'Welcome',
    body: `${md('harbor')}

A small site about making things slowly and writing them down — and a working demo of **pooppress**, a CMS that compiles to plain HTML.

Start with the [blog](blog/) — six posts on writing, static sites, and a rainy trip to the coast. Or read [about this site](about.html) and how it's built, or [get in touch](contact.html).

Everything you see here is a static file. The admin panel wrote it, the build compiled it, and the server's only job was to hand it over.
`
  },
  {
    slug: 'about',
    title: 'About',
    body: `${md('window')}

This site is a demo of **pooppress** — a CMS that writes plain HTML so your readers never wait on a database.

We keep things deliberately small here. A handful of posts, a couple of pages, no comment section, no newsletter popup. The text is the product.

## Colophon

- Written in the pooppress admin, in Markdown
- Built as static files with [poops](https://github.com/stamat/poops)
- Served from a single folder — every page you see is a file on disk
`
  },
  {
    slug: 'contact',
    title: 'Contact',
    body: `The best way to reach us is email: [hello@example.com](mailto:hello@example.com)

We read everything, and reply to most of it within a few days. No forms, no tickets — a plain inbox has worked for twenty years and still does.

> If it's about something you read here, include the link. Future-you will thank present-you.
`
  }
]

const POSTS = [
  {
    slug: 'hello-world',
    title: 'Hello, World',
    published_at: '2026-03-04 09:00:00',
    excerpt: 'Every site needs a first post. This one explains what this place is and what to expect from it.',
    body: `${md('dunes')}

Every site needs a first post, and this is ours. There is no grand mission statement — this is a small site about making things slowly and writing them down.

Expect a post or two a month. Expect them to be short. Expect the occasional photograph and the occasional detour into how this site itself is put together.

That's the whole pitch. Welcome.
`
  },
  {
    slug: 'on-writing-less',
    title: 'On Writing Less',
    published_at: '2026-03-21 10:30:00',
    excerpt: 'Shorter posts survive editing. A case for cutting the second half of everything you draft.',
    body: `The hardest part of writing is not producing words. It is deleting them.

## The half rule

Draft the post, then cut it in half. Not polish — *cut*. The second half of most drafts is the first half restated with less conviction.

> I didn't have time to write a short letter, so I wrote a long one instead.
> — Mark Twain (probably)

## What survives the cut

- The one example that made you want to write the post
- The sentence you were afraid to publish
- The ending you wrote first

${md('stones')}

Everything else was scaffolding. Scaffolding comes down when the building stands.
`
  },
  {
    slug: 'field-guide-to-static-sites',
    title: 'A Field Guide to Static Sites',
    published_at: '2026-04-18 08:15:00',
    excerpt: 'What actually happens when a reader opens a page here — the entire stack, described in one breath.',
    body: `${md('grid')}

When you opened this page, here is everything that happened on the server:

\`\`\`text
GET /blog/field-guide-to-static-sites.html
→ read file from disk
→ send it
\`\`\`

That's the list. No database woke up, no template rendered, no cache was consulted, warmed, or invalidated.

## The trade

A static site trades flexibility at *request time* for simplicity at *serve time*. The work still happens — writing, rendering, resizing images — it just happens once, at build, instead of on every visit.

1. You write in an admin panel
2. The build compiles the database to HTML
3. Readers get files

The parts that fail under load are gone because they are not there.
`
  },
  {
    slug: 'photographs-from-the-coast',
    title: 'Photographs from the Coast',
    published_at: '2026-05-27 17:45:00',
    excerpt: 'Three days on the coast with a camera and no plan. The grey days turned out to be the good ones.',
    body: `Three days on the coast, no itinerary, one camera. The forecast said rain and the forecast was right — which turned out to be the point.

${md('tide')}

Grey light flattens everything, and flat is honest. The tide goes out further than seems reasonable and leaves the whole beach as evidence.

${md('harbor')}

The harbor was the quietest place in town. Nothing moved but the water, and the water barely.

${md('path')}

Inland, the paths between hedges all look like this: a straight line pretending the weather is somewhere else's problem. Best three days of the spring.
`
  },
  {
    slug: 'reading-list-spring-2026',
    title: 'Reading List, Spring 2026',
    published_at: '2026-06-14 11:00:00',
    excerpt: 'Four things worth your time this spring — two essays, a book, and one very long README.',
    body: `Four things worth your time, in the order I'd hand them to you:

1. **An essay on maintenance** — the argument that keeping things working is more interesting than making new things. Reread it every time something breaks.
2. **A book about harbors** — nominally about ports, actually about everything cities pretend to be.
3. **An essay on notebooks** — why paper survives every app that was supposed to replace it.
4. **A README longer than most novellas** — documentation as literature. It can be done.

${md('field')}

The pattern across all four: people who look after things write better than people who launch things. Spring conclusion, subject to autumn revision.
`
  },
  {
    slug: 'how-this-site-is-built',
    title: 'How This Site Is Built',
    published_at: '2026-07-22 09:30:00',
    excerpt: 'The stack behind this demo, from the admin panel to the folder of HTML your browser just read.',
    body: `This site practices what the field guide preached. The pipeline, end to end:

\`\`\`text
admin panel → SQLite → build → output/ → you
\`\`\`

Posts live in a single SQLite file. On publish, the build exports every published post to Markdown with front matter, hands the folder to a static generator, and swaps the new output into place atomically — readers never see a half-built site.

## Images

Every upload is resized into responsive variants at upload time, not at request time:

- \`480w\`, \`960w\`, \`1600w\` — as WebP
- the original, untouched

${md('dunes')}

The image above is served as a plain file, like everything else here. The server's whole job during your visit was to exist.
`
  }
]

const seeded = []
for (const page of PAGES) {
  if (posts.bySlug(null, page.slug)) continue
  posts.create({ slug: page.slug, title: page.title, body_markdown: page.body, author_id: AUTHOR_ID, status: 'published', published_at: '2026-03-01 09:00:00' })
  seeded.push(page.slug)
}
for (const post of POSTS) {
  if (posts.bySlug(BLOG_ID, post.slug)) continue
  posts.create({ collection_id: BLOG_ID, slug: post.slug, title: post.title, body_markdown: post.body, excerpt: post.excerpt, author_id: AUTHOR_ID, status: 'published', published_at: post.published_at })
  seeded.push(`blog/${post.slug}`)
}

// 6 posts, 4 per page → pagination gets demoed too.
collections.update(BLOG_ID, { paginate: 4 })

// Curated header menu (internal urls site-relative, external with scheme) —
// only when empty, so a rerun never clobbers menu edits made in the admin.
if (!(settings.get('menu') || []).length) {
  settings.set('menu', [
    { label: 'Blog', url: 'blog' },
    { label: 'About', url: 'about.html' },
    { label: 'Contact', url: 'contact.html' },
    { label: 'poops', url: 'https://github.com/stamat/poops' }
  ])
  seeded.push('menu')
}

console.log('seeded:', seeded.join(', ') || 'nothing (all slugs existed)')

const { buildSite } = await import('./server/build/bridge.js')
const result = await buildSite()
console.log('built:', result.posts, 'posts')
