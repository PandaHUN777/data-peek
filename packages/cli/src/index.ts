import { createRequire } from 'node:module'
import { HELP, parseArgs } from './args'
import { runDoctor } from './doctor'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), {
    DATABASE_URL: process.env.DATABASE_URL
  })

  switch (parsed.command) {
    case 'help':
      process.stdout.write(HELP)
      return 0
    case 'version':
      process.stdout.write(`${version}\n`)
      return 0
    case 'error':
      process.stderr.write(`${parsed.message}\n\n${HELP}`)
      return 2
    case 'doctor': {
      const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY
      const result = await runDoctor({
        ...parsed.options,
        color: parsed.options.color && !noColor
      })
      if (result.stdout) process.stdout.write(result.stdout + '\n')
      if (result.stderr) process.stderr.write(result.stderr + '\n')
      return result.exitCode
    }
  }
}

// Set exitCode rather than calling process.exit(): a report piped into jq can
// exceed the pipe buffer, and process.exit() drops whatever hasn't flushed.
main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exitCode = 2
  }
)
