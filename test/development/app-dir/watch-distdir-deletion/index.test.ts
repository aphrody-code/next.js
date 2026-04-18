import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'
import fs from 'fs'
import path from 'path'

describe('app-dir watch-distdir-deletion', () => {
  const { next } = nextTestSetup({
    files: path.join(__dirname, 'fixture'),
  })

  it('should restart the server when distDir is deleted', async () => {
    // Wait for the dev server to be ready
    await retry(async () => {
      expect(next.cliOutput).toMatch(/ready/i)
    })

    // Make a request first to ensure the dev server has compiled
    const warmupRes = await next.fetch('/')
    expect(warmupRes.status).toBe(200)

    // Delete .next (which also removes .next/dev, the watched distDir).
    // If rm races with the dev server writing new files into .next, we can hit
    // ENOTEMPTY. On failure, list what remains so we can diagnose which files
    // the server is still writing.
    const distDir = path.join(next.testDir, '.next')
    try {
      await fs.promises.rm(distDir, { recursive: true, force: true })
    } catch (err) {
      let remaining: string[] = []
      try {
        const walk = async (dir: string) => {
          for (const entry of await fs.promises.readdir(dir, {
            withFileTypes: true,
          })) {
            const full = path.join(dir, entry.name)
            remaining.push(full)
            if (entry.isDirectory()) await walk(full)
          }
        }
        await walk(distDir)
      } catch {}
      const e = err as Error
      e.message += `\nRemaining entries under ${distDir} (${remaining.length}):\n${remaining.join('\n')}`
      throw e
    }

    // Wait for restart message and server to come back up
    await retry(
      async () => {
        expect(next.cliOutput).toMatch(/The directory at .* was deleted/)
      },
      30_000,
      1000
    )

    // Server should come back up and serve pages
    await retry(
      async () => {
        const res = await next.fetch('/')
        expect(res.status).toBe(200)
      },
      30_000,
      1000
    )
  })
})
