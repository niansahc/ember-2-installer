// Electron 42+ downloads its binary the first time the package's bin script runs,
// not at install. Run it once here, before any worker, so parallel launchApp calls
// never race the download. --version prints and exits without opening a window.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async () => {
  const cli = path.join(path.dirname(require.resolve('electron/package.json')), 'cli.js')
  execFileSync(process.execPath, [cli, '--version'], { stdio: 'inherit', timeout: 300000 })
}
