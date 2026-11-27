// True when any part of `bounds` lies on a display. Edge contact does not count.
function intersectsDisplay(bounds, displays) {
  return displays.some((d) => {
    const r = d.bounds
    return bounds.x < r.x + r.width && bounds.x + bounds.width > r.x && bounds.y < r.y + r.height && bounds.y + bounds.height > r.y
  })
}

module.exports = { intersectsDisplay }
