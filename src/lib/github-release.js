// A GitHub releases API response, as fetchRelease (src/main.js) receives it.
// Pure, so it can be unit-tested without the network.

// The release object for a 200 with a JSON body; null for anything else. A
// 404 (a tag with no GitHub Release) or a 403 (rate limit) also carries a JSON
// body, { message }, which must not pass for a release.
function releaseFromResponse(statusCode, body) {
  if (statusCode !== 200) return null
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

module.exports = { releaseFromResponse }
