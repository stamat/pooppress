#!/usr/bin/env node
import Argoyle from 'argoyle'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const cli = new Argoyle(pkg.version)
  .line('Usage: pooppress <command> [options]\n')
  .line('Commands:')
  .line('  init                        Set up a new site in this directory')
  .line('  start                       Run the admin server')
  .line('  build                       Build the site into output/')
  .line('  deploy                      Mirror output/ to its destination')
  .line('  import wxr <export.xml>     Import a WordPress export\n')
  .line('Options:')
  .option('port', { short: 'p', value: '<number>', description: 'Port to listen on (start)', callback: (value) => parseInt(value, 10) })
  .option('method', { short: 'm', value: '<name>', description: 'Deploy method: copy or rsync' })
  .option('target', { short: 't', value: '<path>', description: 'Deploy target directory (copy)' })
  .option('host', { value: '<user@host>', description: 'Deploy host (rsync)' })
  .option('path', { value: '<path>', description: 'Remote path (rsync)' })
  .option('collection', { short: 'c', value: '<slug>', description: 'Collection to import into', default: 'blog' })
  .option('skip-media', { description: 'Skip downloading attachments on import' })
  .line('')
  .line('Examples:')
  .line('  pooppress init && pooppress start')
  .line('  pooppress deploy --method=rsync --host=me@example.com --path=/var/www/html')
  .line('  pooppress import wxr export.xml --collection blog')

let flags, positionals
try {
  ({ flags, positionals } = cli.parse())
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const commands = {
  async start() {
    const { start } = await import('../server/index.js')
    start(flags.port || undefined)
  },

  async init() {
    const { runWizard } = await import('../server/setup.js')
    await runWizard()
  },

  async build() {
    const { runBuild, buildState } = await import('../server/build/runner.js')
    await runBuild('cli')
    if (buildState.state === 'error') {
      console.error(buildState.error)
      process.exit(1)
    }
    console.log('Build complete.')
  },

  async deploy() {
    const { deploy } = await import('../server/deploy.js')
    const result = await deploy({ method: flags.method, target: flags.target, host: flags.host, path: flags.path })
    console.log(`Deployed via ${result.method}.`)
  },

  async import() {
    const [format, file] = positionals.slice(1)
    if (format !== 'wxr' || !file) {
      console.error('Usage: pooppress import wxr <export.xml> [--collection blog] [--skip-media]')
      process.exit(1)
    }
    const { importWxr } = await import('../server/import/wxr.js')
    const result = await importWxr(file, { collection: flags.collection, skipMedia: flags['skip-media'] })
    console.log(`Imported ${result.posts} posts, ${result.pages} pages, ${result.users} users, ${result.media} media files.`)
    console.log('Imported accounts have no usable password — set one in Users.')
  }
}

const command = positionals[0] || 'start'
const run = commands[command]
if (!run) {
  console.error(`Unknown command "${command}".\n`)
  console.error(cli.help())
  process.exit(1)
}
await run()
