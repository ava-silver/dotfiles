---
description: Run gt restack on the current branch/stack, resolving conflicts commit by commit
---
Load and follow `/skill:git-workflow` for all git/gt conventions in this task.

Restack only the current branch's stack -- do not touch or restack any other
stack in the repo.

1. Run `gt restack` on the current branch.
2. If it stops on a conflict, resolve the conflict, `git add` the fixed files,
   then run `gt continue`. Repeat until the restack completes.
3. Do not run typechecking, linting, or formatting after each individual
   commit -- that's too slow. Only run the repo's standard checks once, after
   the entire restack has finished cleanly, and fix anything they surface.
4. Once restacked and checks pass, push the stack with `gt ss --no-edit -q`
   (never `git push`).
