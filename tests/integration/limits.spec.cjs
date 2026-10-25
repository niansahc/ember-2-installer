// Time limits under the one-at-a-time lock (src/exec/limits.js,
// src/lib/exclusive.js): a command that hangs is killed at its limit and the
// lock is free again. Real subprocesses (harmless node scripts), no Electron.

const { test, expect } = require('@playwright/test')
const { run } = require('../../src/exec/run')
const { createExclusive } = require('../../src/lib/exclusive')
const { gitNetworkEnv } = require('../../src/exec/limits')

const NODE = process.execPath
const quick = async () => ({ ok: true })

test.describe('time limits under the lock', () => {
  test('a command that hangs past its limit is killed, and the lock is free again', async () => {
    const exclusive = createExclusive()
    const hung = exclusive('An update', () => run(NODE, ['-e', 'setInterval(() => {}, 1000)'], { shell: false, timeout: 1500 }))
    const r = await hung
    expect(r.timedOut).toBe(true)
    expect(r.error).toBe('timed out after 1500ms')
    expect(await exclusive('A fresh install', quick)).toEqual({ ok: true })
  })

  test('control: while the command runs, the lock refuses', async () => {
    const exclusive = createExclusive()
    const hung = exclusive('An update', () => run(NODE, ['-e', 'setInterval(() => {}, 1000)'], { shell: false, timeout: 1500 }))
    expect((await exclusive('A fresh install', quick)).busy).toBe(true)
    await hung
  })

  test('git clone and fetch get git\'s own stall limit, on top of the parent environment', () => {
    const env = gitNetworkEnv({ PATH: '/bin', HOME: '/home/x' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/x', GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '60' })
  })
})
