// Shared helper for upserting a "sticky" PR comment keyed by an HTML
// marker. Used by:
//   - scripts/post-e2e-failure-comment.mjs    (marker: e2e-failures:shard-N)
//   - scripts/post-verify-failure-comment.mjs (marker: verify-failures)
//
// Pagination is capped at 10 pages of 100 comments (1000 total) which
// matches the historical E2E poster behaviour.

const COMMENT_PAGE_LIMIT = 10;
const COMMENT_PAGE_SIZE = 100;

async function gh(method, urlPath, { token, body } = {}) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'showbook-ci',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${urlPath} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function findStickyComment({ repo, prNumber, token, marker }) {
  for (let page = 1; page <= COMMENT_PAGE_LIMIT; page += 1) {
    const comments = await gh(
      'GET',
      `/repos/${repo}/issues/${prNumber}/comments?per_page=${COMMENT_PAGE_SIZE}&page=${page}`,
      { token },
    );
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const hit = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));
    if (hit) return hit;
    if (comments.length < COMMENT_PAGE_SIZE) return null;
  }
  return null;
}

/**
 * Upsert a sticky PR comment.
 *   - If a comment containing `marker` already exists on the PR, PATCH it.
 *   - Otherwise POST a new one.
 *
 * The marker must already be present somewhere in `body` (typically the
 * first line) — the caller controls placement so it can be hidden inside
 * an HTML comment.
 *
 * Returns { action: 'updated'|'created', id }.
 */
export async function upsertStickyComment({ repo, prNumber, token, marker, body }) {
  if (!repo || !prNumber || !token) {
    throw new Error('upsertStickyComment: repo / prNumber / token are required');
  }
  if (!body.includes(marker)) {
    throw new Error('upsertStickyComment: body must contain the marker string');
  }
  const existing = await findStickyComment({ repo, prNumber, token, marker });
  if (existing) {
    await gh('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, {
      token,
      body: { body },
    });
    return { action: 'updated', id: existing.id };
  }
  const created = await gh('POST', `/repos/${repo}/issues/${prNumber}/comments`, {
    token,
    body: { body },
  });
  return { action: 'created', id: created.id };
}
