---
name: gate-run-quirks
description: Known quirks when running this project's QA gate tools (Playwright report dirtying, ECONNREFUSED noise, CodeRabbit absent)
metadata:
  type: project
---

Running `npx playwright test` in frontend rewrites the tracked `frontend/playwright-report/index.html`; restore it with `git checkout -- frontend/playwright-report` after the gate.
~74 ECONNREFUSED vite proxy lines in the Playwright log are expected noise (no failures), registered since gate 5.1.
CodeRabbit is not installed (skill paths are WSL/Windows, host is macOS); gates record it as TEST-001 low.

**Why:** recurring in gates 5.1-5.3; avoids re-investigating.
**How to apply:** restore the report before handing back; don't flag the proxy noise as a regression.
