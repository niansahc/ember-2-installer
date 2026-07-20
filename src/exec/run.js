// Process-execution helpers. Unlike src/lib (pure logic), modules here do I/O
// (spawn child processes) and are exercised by hermetic integration tests.
//
// run() is the single spawn engine for the installer (issue #7). It is
// deliberately IPC-agnostic — it never imports Electron. Streaming callers pass
// an onData(chunk, stream) hook and map it to their own IPC channel; the
// webContents.send side-effects live in the caller/adapter, not here. That is
// what keeps run() unit-testable without booting Electron.

const { spawn } = require('child_process')

// Kill the whole process tree, not just the direct child. With shell:true the
// direct child is the shell (cmd.exe / sh) and the real command is its child;
// killing only the shell can orphan that grandchild. On Windows, taskkill /T
// walks the tree; on POSIX we group-kill (run() sets detached when a timeout is
// requested, so the child leads its own process group).
function killTree(proc, detached) {
  if (!proc || proc.pid == null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } else if (detached) {
      process.kill(-proc.pid, 'SIGKILL')
    } else {
      proc.kill('SIGKILL')
    }
  } catch {
    // Process already gone — nothing to kill.
  }
}

// Run a command and resolve a uniform result. NEVER rejects — the whole
// codebase relies on this invariant, so every failure mode is folded into the
// resolved object:
//   { ok, code, stdout, stderr, error, timedOut }
// ok = okCodes.includes(code). stdout/stderr are always buffered AND, if onData
// is supplied, streamed chunk-by-chunk. shell:true is the default for parity
// with the original handlers; flipping specific sites to shell:false + array
// args (so metacharacters arrive literally) is the injection work tracked in #11.
function run(command, args = [], {
  cwd,
  env,
  shell = true,
  onData,
  okCodes = [0],
  timeout,
} = {}) {
  return new Promise((resolve) => {
    const opts = { shell }
    if (cwd) opts.cwd = cwd
    if (env) opts.env = env
    // A timeout needs a killable process group on POSIX; detached makes the
    // child a group leader so killTree can signal the whole group.
    const detached = timeout != null && process.platform !== 'win32'
    if (detached) opts.detached = true

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    const proc = spawn(command, args, opts)

    if (proc.stdout) {
      proc.stdout.on('data', (d) => {
        const s = d.toString()
        stdout += s
        if (onData) onData(s, 'stdout')
      })
    }
    if (proc.stderr) {
      proc.stderr.on('data', (d) => {
        const s = d.toString()
        stderr += s
        if (onData) onData(s, 'stderr')
      })
    }

    proc.on('close', (code) => {
      finish({
        ok: timedOut ? false : okCodes.includes(code),
        code,
        stdout,
        stderr,
        error: null,
        timedOut,
      })
    })

    proc.on('error', (err) => {
      finish({ ok: false, code: null, stdout, stderr, error: err.message, timedOut })
    })

    if (timeout != null) {
      timer = setTimeout(() => {
        timedOut = true
        killTree(proc, detached)
        finish({
          ok: false,
          code: null,
          stdout,
          stderr,
          error: `timed out after ${timeout}ms`,
          timedOut: true,
        })
      }, timeout)
    }
  })
}

module.exports = { run }
