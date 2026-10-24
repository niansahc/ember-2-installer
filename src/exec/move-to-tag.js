// Move an installer clone of ember-2 or ember-2-ui to a release tag, the only
// way an update changes either repo, so an install only ever sits on a tag the
// installer pins (src/lib/release-pin.js). Built on run().

const fs = require('fs')
const path = require('path')
const { run } = require('./run')

// Same directory, after resolving symlinks and Windows 8.3 short names.
function samePath(a, b) {
  try {
    const norm = (p) => fs.realpathSync.native(path.resolve(p))
    const [x, y] = [norm(a), norm(b)]
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
  } catch {
    return false
  }
}

// Same repository URL, ignoring case, a trailing slash and a trailing .git.
function sameRepo(a, b) {
  const norm = (u) => String(u).trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '')
  return norm(a) === norm(b)
}

// A URL as it may be shown: any user:password@ part is dropped.
const shownUrl = (u) => u.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')

// Whether cwd is an installer clone: 'shallow' (installer clones are --depth
// 1), 'full' (a developer's working repo, or a clone from an installer before
// --depth), or 'none' when cwd is not the top of its own repository (so a
// directory that is not a clone never stands in for an enclosing repository).
// Resolves { state, error? }; error is set when git itself could not run.
async function cloneState(cwd) {
  const probe = await run('git', ['rev-parse', '--show-toplevel', '--is-shallow-repository'], { cwd })
  if (probe.error !== null) return { state: 'none', error: probe.error }
  const [top, shallow] = probe.stdout.trim().split(/\r?\n/)
  if (!probe.ok || !samePath(top, cwd)) return { state: 'none' }
  return { state: shallow === 'true' ? 'shallow' : 'full' }
}

// Steps, each a refusal or a git call, in order:
//   0. Refuse unless cwd is the top of its own repository (cloneState).
//   1. Refuse a full clone. getEmberPath falls back to the sibling ember-2 in
//      unpackaged --real mode, a developer's repo that is never moved.
//   2. Refuse unless the stored origin is url, the repository this clone
//      should be, so an unrelated clone that happens to carry the tag is never
//      reset or moved. The stored value is read (git config), not the one
//      after url.<base>.insteadOf rewrites (git remote get-url).
//   3. Refuse if tracked files other than resetFiles are modified: the user
//      edited them, and a checkout would either fail or carry the edits onto
//      the tag. Untracked files (.venv, the env file, ui/) are left alone.
//   4. Fetch only that tag, shallow. The fetch overwrites a local tag of the
//      same name (+), so a tag re-pointed upstream is followed, not refused.
//   5. Reset resetFiles, the tracked files the installer itself rewrites
//      (backend version.json from older installers, UI package-lock.json from
//      npm ci), then check the tag out detached. Until this step nothing in
//      the clone has changed, so every earlier failure leaves it as it was.
// Resolves { ok, error? } and never rejects, like run().
async function moveToTag({ cwd, tag, url, onData, resetFiles = [] }) {
  const git = (args, opts = {}) => run('git', args, { cwd, ...opts })
  const fail = (error) => ({ ok: false, error })
  if (!url) return fail('moveToTag: no repository URL given')

  const clone = await cloneState(cwd)
  if (clone.error) return fail(clone.error)
  if (clone.state === 'none') return fail(`${cwd} is not a git repository`)
  if (clone.state === 'full') {
    return fail(`${cwd} is a full git clone, not an installer install; update it with git yourself`)
  }

  const origin = await git(['config', '--get', 'remote.origin.url'])
  const originUrl = origin.ok ? origin.stdout.trim() : ''
  if (!originUrl || !sameRepo(originUrl, url)) {
    const shown = originUrl ? shownUrl(originUrl) : 'no known repository'
    return fail(`${cwd} is a clone of ${shown}, not ${url}; it was left as is`)
  }

  const status = await git(['status', '--porcelain', '--untracked-files=no'])
  if (!status.ok) return fail(status.error || 'git status failed')
  const modified = status.stdout.split(/\r?\n/).map((l) => l.slice(3).trim())
    .filter((f) => f && !resetFiles.includes(f))
  if (modified.length) {
    return fail(`Local changes to ${modified.join(', ')} in ${cwd}. Undo or move them, then retry the update.`)
  }

  const ref = `refs/tags/${tag}`
  const fetched = await git(['fetch', '--depth', '1', '--no-tags', 'origin', `+${ref}:${ref}`], { onData })
  if (!fetched.ok) return fail(fetched.error || `git fetch of ${tag} exited with code ${fetched.code}`)
  for (const f of resetFiles) await git(['checkout', '--', f])
  const checkedOut = await git(['checkout', '--detach', ref], { onData })
  if (!checkedOut.ok) return fail(checkedOut.error || `git checkout of ${tag} exited with code ${checkedOut.code}`)
  return { ok: true }
}

module.exports = { moveToTag, cloneState }
