// Move an installer clone of ember-2 or ember-2-ui to a release tag. Updates
// call this in place of `git pull origin main`, so an install only ever sits
// on a tag the installer pins (src/lib/release-pin.js). Built on run().

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

// Steps, each a refusal or a git call, in order:
//   0. Refuse unless cwd is the top of its own repository, so a directory that
//      is not a clone never moves an enclosing repository instead.
//   1. Refuse a full clone. Installer clones are shallow (--depth 1); a full
//      clone is a developer's working repo (getEmberPath falls back to the
//      sibling ember-2 in unpackaged --real mode) and is never moved.
//   2. Reset resetFiles, the tracked files the installer itself rewrites
//      (backend version.json from older installers, UI package-lock.json from
//      npm ci).
//   3. Refuse if tracked files are still modified: the user edited them, and
//      a checkout would either fail or carry the edits onto the tag.
//      Untracked files (.venv, the env file, ui/) are left alone.
//   4. Fetch only that tag, shallow, then check it out detached.
// Resolves { ok, error? } and never rejects, like run().
async function moveToTag({ cwd, tag, onData, resetFiles = [] }) {
  const git = (args, opts = {}) => run('git', args, { cwd, ...opts })
  const fail = (error) => ({ ok: false, error })

  // One call answers steps 0 and 1: the top of the repository, then whether
  // it is shallow, one per line.
  const probe = await git(['rev-parse', '--show-toplevel', '--is-shallow-repository'])
  if (probe.error !== null) return fail(probe.error)
  const [top, shallow] = probe.stdout.trim().split(/\r?\n/)
  if (!probe.ok || !samePath(top, cwd)) return fail(`${cwd} is not a git repository`)
  if (shallow !== 'true') {
    return fail(`${cwd} is a full git clone, not an installer install; update it with git yourself`)
  }

  for (const f of resetFiles) await git(['checkout', '--', f])

  const status = await git(['status', '--porcelain', '--untracked-files=no'])
  if (!status.ok) return fail(status.error || 'git status failed')
  const modified = status.stdout.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean)
  if (modified.length) {
    return fail(`Local changes to ${modified.join(', ')} in ${cwd}. Undo or move them, then retry the update.`)
  }

  const ref = `refs/tags/${tag}`
  const fetched = await git(['fetch', '--depth', '1', '--no-tags', 'origin', `${ref}:${ref}`], { onData })
  if (!fetched.ok) return fail(fetched.error || `git fetch of ${tag} exited with code ${fetched.code}`)
  const checkedOut = await git(['checkout', '--detach', ref], { onData })
  if (!checkedOut.ok) return fail(checkedOut.error || `git checkout of ${tag} exited with code ${checkedOut.code}`)
  return { ok: true }
}

module.exports = { moveToTag }
