// Replace a folder with a fresh clone without losing it when the clone fails:
// the folder is renamed aside first and put back if the clone does not finish.
// A rename either happens whole or not at all, so unlike deleting first, a
// folder with a file held open (a running API's venv) is left untouched.

const fs = require('fs')

// A free sibling name for dir: <dir>.old-<YYYY-MM-DD>, with -2, -3 ... added
// when that name is taken.
function asidePath(dir, now = new Date()) {
  const base = `${dir}.old-${now.toISOString().slice(0, 10)}`
  let candidate = base
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}`
  return candidate
}

// Run clone() (it creates dir, resolving { ok, error? }) in place of an
// existing dir. A failed clone's partial dir is removed and the old one is
// renamed back. After a successful clone the old dir is removed unless keep is
// set. Resolves clone()'s result plus aside: the old dir's path while it still
// exists (kept, or left behind because it could not be removed), else null.
async function replaceWithClone({ dir, clone, keep = false, now }) {
  if (!fs.existsSync(dir)) return { ...(await clone()), aside: null }

  const aside = asidePath(dir, now)
  try {
    fs.renameSync(dir, aside)
  } catch (err) {
    return { ok: false, error: `Cannot move ${dir} aside, so it was left as is: ${err.message}`, aside: null }
  }

  const r = await clone()
  if (!r.ok) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.renameSync(aside, dir)
      return { ...r, aside: null }
    } catch (err) {
      return { ...r, error: `${r.error}. The previous folder is at ${aside} (${err.message}).`, aside }
    }
  }

  if (!keep) {
    try {
      fs.rmSync(aside, { recursive: true, force: true })
    } catch {}
  }
  return { ...r, aside: fs.existsSync(aside) ? aside : null }
}

module.exports = { asidePath, replaceWithClone }
