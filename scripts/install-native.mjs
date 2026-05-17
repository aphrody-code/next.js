import os from 'os'
import path from 'path'
import execa from 'execa'
import fs from 'fs'
import fsp from 'fs/promises'
import { outdent } from 'outdent'
;(async function () {
  if (process.env.NEXT_SKIP_NATIVE_POSTINSTALL) {
    console.log(
      `Skipping next-swc postinstall due to NEXT_SKIP_NATIVE_POSTINSTALL env`
    )
    return
  }

  const preferOffline = process.env.NEXT_TEST_PREFER_OFFLINE === '1'

  let cwd = process.cwd()
  const { version: nextVersion } = JSON.parse(
    fs.readFileSync(path.join(cwd, 'packages', 'next', 'package.json'))
  )

  try {
    // if installed swc package version matches monorepo version
    // we can skip re-installing
    for (const pkg of fs.readdirSync(path.join(cwd, 'node_modules', '@next'))) {
      if (
        pkg.startsWith('swc-') &&
        JSON.parse(
          fs.readFileSync(
            path.join(cwd, 'node_modules', '@next', pkg, 'package.json')
          )
        ).version === nextVersion
      ) {
        console.log(`@next/${pkg}@${nextVersion} already installed, skipping`)
        return
      }
    }
  } catch {}

  try {
    let tmpdir = path.join(os.tmpdir(), `next-swc-${Date.now()}`)
    fs.mkdirSync(tmpdir, { recursive: true })
    let pkgJson = {
      name: 'dummy-package',
      version: '1.0.0',
      optionalDependencies: {
        '@next/swc-darwin-arm64': nextVersion,
        '@next/swc-darwin-x64': nextVersion,
        '@next/swc-linux-arm64-gnu': nextVersion,
        '@next/swc-linux-arm64-musl': nextVersion,
        '@next/swc-linux-x64-gnu': nextVersion,
        '@next/swc-linux-x64-musl': nextVersion,
        '@next/swc-win32-arm64-msvc': nextVersion,
        '@next/swc-win32-x64-msvc': nextVersion,
      },
    }
    fs.writeFileSync(path.join(tmpdir, 'package.json'), JSON.stringify(pkgJson))

    // bun replaces the pnpm-workspace.yaml security knobs with `.bunfig.toml`.
    // We mirror the minimal subset needed at install time (no workspace, no
    // exotic-subdeps protection — same effect via bun's default isolation).
    fs.writeFileSync(
      path.join(tmpdir, '.bunfig.toml'),
      '# SPDX-License-Identifier: Apache-2.0\n' +
        '[install]\n' +
        'production = false\n' +
        'peer = true\n' +
        outdent`
          # Mirror of pnpm-workspace.yaml minimumReleaseAge=2880 intent
          # (bun does not implement this knob yet — exclusions are advisory).
        ` +
        '\n'
    )

    // `bun add` with `--no-save` to skip lockfile writes (mirrors pnpm
    // `--lockfile=false`). `--ignore-scripts` keeps postinstall safe.
    const args = ['add', `next@${nextVersion}`, '--no-save', '--ignore-scripts']
    if (preferOffline) {
      args.push('--prefer-offline')
    }
    await execa('bun', args, { cwd: tmpdir })

    let pkgs = fs.readdirSync(path.join(tmpdir, 'node_modules/@next'))
    fs.mkdirSync(path.join(cwd, 'node_modules/@next'), { recursive: true })

    await Promise.all(
      pkgs.map(async (pkg) => {
        const from = path.join(tmpdir, 'node_modules/@next', pkg)
        const to = path.join(cwd, 'node_modules/@next', pkg)
        // bun's node_modules entries may be symlinks (cache-backed) on some
        // platforms — remove the destination first to avoid EEXIST.
        await fsp.rm(to, { recursive: true, force: true })
        // Renaming is flaky on Windows, and the tmpdir is going to be deleted anyway,
        // so we use copy the directory instead.
        return fsp.cp(from, to, { force: true, recursive: true })
      })
    )
    fs.rmSync(tmpdir, { recursive: true, force: true })
    console.log('Installed the following binary packages:', pkgs)
  } catch (e) {
    throw new Error('Failed to install @next/swc binary packages', { cause: e })
  }
})()
