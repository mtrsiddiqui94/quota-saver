---
description: Build a feature or code. Example: /build a search box on the users list
argument-hint: [what to build]
---
Build this: $ARGUMENTS

Work lean:
1. Find the closest existing pattern in the codebase with targeted search and follow it; do not read unrelated files.
2. Implement with small Edits; create new files only when needed.
3. Run the narrowest check that proves it works (piping output through `tail -30`).
If the request is ambiguous in a way that changes the design, ask one short question first.
Reply in the user's language, at most 6 lines: what was added (file paths) and how it was verified.
