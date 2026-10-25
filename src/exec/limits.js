// Time limits for the commands that run while the one-at-a-time lock is held
// (src/lib/exclusive.js). A command that hangs (a download that stalled, a
// docker daemon that never answers) would otherwise keep the lock, and refuse
// every later clone, update and build, until the app restarts. The limits are
// generous: they stop a command that has stopped, never a slow connection
// still doing its job. run() kills the whole process tree when one expires.

const MINUTE = 60 * 1000

const TIMEOUTS = {
  gitLocal: 2 * MINUTE, // rev-parse, config, status, checkout, tag
  gitNetwork: 30 * MINUTE, // clone and fetch; a stall ends sooner (gitNetworkEnv)
  apiKey: 2 * MINUTE, // set_api_key.py
  npmCi: 30 * MINUTE,
  uiBuild: 15 * MINUTE,
  pip: 60 * MINUTE,
  docker: 30 * MINUTE, // compose up --build, which may pull images
  kill: MINUTE, // taskkill, pkill
  ollamaList: 2 * MINUTE,
  ollamaPull: 60 * MINUTE,
}

// The environment for git clone and fetch: git gives up on its own when the
// transfer stays under 1 KB/s for 60 seconds, well before gitNetwork.
function gitNetworkEnv(base = process.env) {
  return { ...base, GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '60' }
}

module.exports = { TIMEOUTS, gitNetworkEnv }
