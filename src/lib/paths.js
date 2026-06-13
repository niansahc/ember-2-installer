// Pure path derivations for an ember-2 install. No fs/Electron deps, so this
// module can be required and unit-tested in isolation (main.js can't — it boots
// the app). All functions are keyed on emberPath, the install root.

const path = require('path')

// The ember-2-ui clone/build dir — a sibling of the ember-2 install root, where
// the installer clones and builds the frontend before copying its dist in.
function uiSourceDir(emberPath) {
  return path.join(path.dirname(emberPath), 'ember-2-ui')
}

// The served UI dir inside the install root — where the built dist is copied so
// the API can serve it.
function uiTargetDir(emberPath) {
  return path.join(emberPath, 'ui')
}

// The built-UI entry point; its presence means the UI has been installed.
function uiIndexFile(emberPath) {
  return path.join(uiTargetDir(emberPath), 'index.html')
}

module.exports = { uiSourceDir, uiTargetDir, uiIndexFile }
