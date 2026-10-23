// Shared git fixture for the integration specs: synchronous git helpers and a
// seeded bare repo. Not a spec (testMatch is *.spec.cjs).

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' })
const gitOut = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const commitAll = (cwd, msg) => {
  git(['add', '.'], cwd)
  git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-m', msg], cwd)
}

// A bare repo in dir with one commit per step ({ files, tag }), as ember-2 has
// between releases: release commits carry a tag, a step without one is
// unreleased work on main. Returns a file:// URL (git ignores --depth on a
// plain local path, so a clone would not be shallow as a real one is) and each
// commit id, keyed by its tag or 'main'.
function seedRepo(dir, steps) {
  const bare = path.join(dir, 'src.git')
  const work = path.join(dir, 'work')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
  fs.mkdirSync(work)
  git(['init', '--initial-branch=main'], work)
  const ids = {}
  for (const { files, tag } of steps) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(work, name), text)
    commitAll(work, tag || 'unreleased work on main')
    if (tag) git(['tag', tag], work)
    ids[tag || 'main'] = gitOut(['rev-parse', 'HEAD'], work)
  }
  git(['remote', 'add', 'origin', bare], work)
  git(['push', 'origin', 'main', '--tags'], work)
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare)
  return { url: pathToFileURL(bare).href, ids }
}

module.exports = { git, gitOut, commitAll, seedRepo }
