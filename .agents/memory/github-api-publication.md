---
name: GitHub API publication
description: Constraint for publishing repository commits through the authenticated GitHub connector when shell credentials are unavailable.
---

When local Git transport has no usable credential helper, the authenticated GitHub Git Data API is a valid fallback, but blob creation must stay below 10 requests per second and retry HTTP 429 responses.

**Why:** Parallel blob creation exceeded the Replit connector’s per-Repl request limit even though the GitHub OAuth connection was healthy and authorized for repository writes.

**How to apply:** Use normal `git push` first. Only for the authenticated API fallback, create blobs sequentially at roughly seven requests per second, verify the remote parent SHA before creating the tree, and update the branch without force.