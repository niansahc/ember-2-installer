// Unit tests for the API launch spec (src/lib/api-launch.js). Requires the
// module directly, no app launch (paths.spec pattern). Both start-api and the
// update-restart path in main.js spawn from apiSpawnSpec.

const { test, expect } = require('@playwright/test')
const path = require('path')
const { API_PKILL_PATTERN, apiSpawnSpec } = require('../../src/lib/api-launch')

const emberPath = path.join('opt', 'ember-2')

test.describe('API launch spec', () => {
  for (const platform of ['linux', 'darwin']) {
    test(`spawns uvicorn on src.api.asgi:app on ${platform}`, () => {
      const spec = apiSpawnSpec(emberPath, platform)
      expect(spec.command).toBe(path.join(emberPath, '.venv', 'bin', 'python'))
      expect(spec.args).toEqual(['-m', 'uvicorn', 'src.api.asgi:app', '--host', '127.0.0.1', '--port', '8000'])
      expect(spec.shell).toBe(false)
    })
  }

  test('Windows launches through start_api.bat', () => {
    expect(apiSpawnSpec(emberPath, 'win32')).toEqual({ command: 'cmd', args: ['/c', 'start_api.bat'], shell: true })
  })

  test('pkill pattern matches the new and the legacy uvicorn command lines', () => {
    const re = new RegExp(API_PKILL_PATTERN)
    expect(re.test('python -m uvicorn src.api.asgi:app --host 127.0.0.1 --port 8000')).toBe(true)
    expect(re.test('python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000')).toBe(true)
  })
})
