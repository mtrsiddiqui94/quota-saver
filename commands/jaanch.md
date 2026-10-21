---
description: Meri tabdeeliyon ka review karo (git diff). Misal: /jaanch ya /jaanch security
argument-hint: [optional: kis cheez pe focus]
---
Review my current uncommitted changes. Focus: $ARGUMENTS

Start with `git diff --stat`, then read the diff file by file (`git diff -- <file>`); skip lockfiles and generated files. Look for real bugs, security issues and missing edge cases only; no style nitpicks.
Reply in the user's language: a numbered list, at most 8 items, each `file:line, problem, fix`. If nothing is wrong, say so in one line.
