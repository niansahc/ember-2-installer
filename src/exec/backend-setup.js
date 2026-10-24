// The backend steps that follow a change to its source: pip install, docker
// compose, and an API restart. They are recorded (recordBackendSetup) only
// when all three succeed, so an update that stopped part way, or a step that
// failed, is offered again by the next update check (backendUpdateAction
// 'finish' in src/exec/pin-action.js).

const { recordBackendSetup } = require('./installed')

// steps: { pip, docker, restart }, each resolving true on success; main.js
// supplies the real commands. A failed step is logged and the next one still
// runs, as before the record existed. Resolves { ok, pipOk, dockerOk, apiOk }.
async function runBackendSetup({ emberPath, tag, steps, log }) {
  const pipOk = await steps.pip()
  if (!pipOk) log('Warning: pip install had issues, continuing...\n')
  const dockerOk = await steps.docker()
  if (!dockerOk) log('Warning: docker compose did not finish, continuing...\n')
  const apiOk = await steps.restart()

  let ok = pipOk && dockerOk && apiOk
  if (ok) {
    try {
      recordBackendSetup(emberPath, tag)
    } catch (err) {
      log(`Could not record the backend setup: ${err.message}\n`)
      ok = false
    }
  }
  if (!ok) log(`The backend setup for ${tag} did not finish, so the next update check offers it again.\n`)
  return { ok, pipOk, dockerOk, apiOk }
}

module.exports = { runBackendSetup }
