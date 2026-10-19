// Runs once after every worker has finished: no installer Electron process may
// outlive the suite. A survivor is killed (so it cannot starve the next run)
// and the run fails, naming the pids.

const { killTree } = require('./helpers.cjs')
const { installerElectronPids } = require('./electron-processes.cjs')

module.exports = async function globalTeardown() {
  const pids = installerElectronPids()
  if (!pids.length) return
  pids.forEach(killTree)
  throw new Error(`e2e suite leaked ${pids.length} installer Electron process(es): ${pids.join(', ')}`)
}
