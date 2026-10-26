// One mutating operation at a time. The IPC handlers that clone, move, build
// or restart an install share one lock, so two screens can never work on the
// same clone at once (two moves colliding on .git/index.lock, one killing the
// API the other is restarting). A call while another runs is refused, not
// queued: queued, it would redo the first one's work on a changed install.
// Pure (no Electron/fs deps) so it can be unit-tested.

// Returns exclusive(label, fn, onBusy): runs fn and resolves its result, or,
// while another call is running, calls onBusy(error) and resolves
// { ok: false, busy: true, error } without running fn. label names the
// operation in that error.
function createExclusive() {
  let running = null
  return async function exclusive(label, fn, onBusy = () => {}) {
    if (running) {
      const error = `${running} is still running. Wait for it to finish, then try again.`
      onBusy(error)
      return { ok: false, busy: true, error }
    }
    running = label
    try {
      return await fn()
    } finally {
      running = null
    }
  }
}

module.exports = { createExclusive }
