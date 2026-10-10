// How the installer launches and stops the ember-2 API. Pure (no fs/Electron
// deps) so the spawn target can be unit-tested; main.js can't be required.

const path = require('path')

// The ASGI entrypoint. src.api.asgi loads .env before building the app;
// src.api.main:app no longer does, so launching it starts the API without config.
const API_APP_TARGET = 'src.api.asgi:app'

// pkill -f pattern for a running API. Matches the old src.api.main target too,
// so an API started by an earlier installer version is still stopped on update.
const API_PKILL_PATTERN = 'uvicorn.*src.api.(main|asgi)'

// The spawn command for the API. Windows goes through ember-2's start_api.bat;
// elsewhere uvicorn runs directly from the install's venv.
function apiSpawnSpec(emberPath, platform) {
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start_api.bat'], shell: true }
  }
  return {
    command: path.join(emberPath, '.venv', 'bin', 'python'),
    args: ['-m', 'uvicorn', API_APP_TARGET, '--host', '127.0.0.1', '--port', '8000'],
    shell: false,
  }
}

module.exports = { API_APP_TARGET, API_PKILL_PATTERN, apiSpawnSpec }
