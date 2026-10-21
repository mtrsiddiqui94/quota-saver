---
description: Run the tests and report only failures. Example: /test-chalao or /test-chalao auth
argument-hint: [optional: which tests]
---
Run the project's tests. Scope (optional): $ARGUMENTS

Detect the test command from the project files (package.json, pyproject, Makefile, etc.) without reading more than needed. Run it so only failures and the summary come back (quiet/reporter flags, or pipe through `tail -40`).
Reply in the user's language, at most 6 lines: pass/fail counts, and for each failure its test name, file:line and a one-line likely cause. Do not fix anything unless asked.
