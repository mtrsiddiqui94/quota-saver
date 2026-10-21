---
description: Bug/error theek karo (fix). Misal: /theek login pe 500 error aa raha hai
argument-hint: [masla ya error]
---
Fix this problem: $ARGUMENTS

Work lean:
1. Locate the cause with targeted search (grep for the error text, function or route); read only the relevant line ranges.
2. Make the smallest correct fix with Edit.
3. Verify with the narrowest check available (one test file, one command), piping output through `tail -30`.
Reply in the user's language, at most 5 lines: the cause, the fix (file:line), and how it was verified.
