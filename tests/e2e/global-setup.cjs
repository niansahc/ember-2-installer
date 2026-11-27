// Electron 42+ downloads its binary the first time the package's bin script runs,
// not at install. Run it once here, before any worker, so parallel launchApp calls
// never race the download. --version prints and exits without opening a window.
// Playwright's own launch passes --no-sandbox on Linux; the CI runner's
// chrome-sandbox is not setuid, so this call needs it too.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async () => {
  const cli = path.join(path.dirname(require.resolve('electron/package.json')), 'cli.js')
  const args = [cli, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--version']
  execFileSync(process.execPath, args, { stdio: 'inherit', timeout: 300000 })
}
