import { createInterface } from 'node:readline/promises'
import { mkdirSync, existsSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, SITE_ROOT, PORT, themeDir } from './config.js'
import { getDb, store, SYSTEM } from './db.js'
import { users, collections, settings } from './queries.js'
import { hashPassword } from './auth.js'

// No database questions — SQLite is a file. Everything the wizard asks for
// lands in the settings table or the users table.
export async function initSite({ title, url = '', description = '', email, password }) {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  chmodSync(DATA_DIR, 0o700) // an existing dir keeps its old mode otherwise

  getDb() // opens the file and runs migrations
  if (users.count() > 0) {
    throw new Error('This directory already has a pooppress install (users exist). Delete data/ to start over.')
  }
  if (!email || !password) throw new Error('An admin email and password are required.')

  users.create({ email, password_hash: hashPassword(password), role: 'admin', display_name: email.split('@')[0] })

  settings.set('site.title', title || 'My site')
  settings.set('site.url', String(url).replace(/\/+$/, ''))
  settings.set('site.description', description)
  settings.set('theme.active', existsSync(themeDir('default')) ? 'default' : '')
  settings.set('plugins.active', [])

  if (!collections.bySlug('blog')) {
    store.collections.create({ name: 'Blog', slug: 'blog', paginate: 10 }, { user: SYSTEM })
  }

  // No .env: PORT comes from the environment (systemd unit, Passenger, shell)
  // and nothing ever read a file here.
  return { created: true, dataDir: DATA_DIR, siteRoot: SITE_ROOT }
}

// node:readline, not a prompt library — the wizard asks five questions.
// Lines are pulled from an async iterator rather than rl.question() so a piped
// answer file works the same as a terminal: question() never settles once the
// input stream hits EOF, which turns a scripted install into a hang.
export async function runWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const lines = rl[Symbol.asyncIterator]()
  const ask = async (label, fallback = '') => {
    process.stdout.write(`  ${label}${fallback ? ` (${fallback})` : ''}: `)
    const { value, done } = await lines.next()
    if (done) {
      if (fallback) return fallback
      throw new Error(`No answer for "${label}" — run \`pooppress init\` interactively, or pipe one line per question.`)
    }
    return String(value).trim() || fallback
  }
  try {
    console.log('\n  Welcome to pooppress.\n\n  Site\n  ' + '─'.repeat(28))
    const title = await ask('Title', 'My Blog')
    const url = await ask('URL', 'https://example.com')
    const description = await ask('Description')

    console.log('\n  Admin account\n  ' + '─'.repeat(28))
    const email = await ask('Email')
    const password = await ask('Password')
    if (!email || !password) throw new Error('Email and password are required.')

    console.log()
    const result = await initSite({ title, url, description, email, password })
    console.log(`  Created ${path.relative(process.cwd(), result.dataDir) || 'data'}/pooppress.db, ran migrations, created the admin user.`)
    console.log(`  Ready. Run \`pooppress start\` — admin panel: http://localhost:${PORT}/admin\n`)
    return result
  } finally {
    rl.close()
  }
}
