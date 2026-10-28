# The Reconstructor

Agent Builder learns to build more kinds of things by rebuilding real apps.
App → Agent → **Reconstructor**, or ask Jarvis (`reconstruct.start`).

## What it does with an app

1. **Study.** Reads the code (the file list, the README, the manifest and the
   most telling source files) and writes a blueprint: what the app is for,
   every user-facing feature with a way to check it, the screens, the data and
   the techniques that make it work.
2. **Rebuild.** Builds the app again in a fresh folder from the blueprint
   alone. It never sees the original code while building, so what it gets
   right is what it can really do.
3. **Compare.** Checks the rebuild against the blueprint, feature by feature:
   coverage is the share it really has (implemented and wired in, not stubs).
4. **Learn.** Every missed feature becomes a general lesson (LessonMemory) that
   every later build is given when it is relevant. The original is kept as a
   worked example (ExemplarMemory) when it is your project or openly licensed
   (MIT, Apache-2.0, BSD, ISC, MPL-2.0, Unlicense). Then it rebuilds the gaps,
   up to three rounds, until it covers 85% or more.

## Is it getting better?

**What it has learned** shows the kinds of apps rebuilt, the features studied,
the lessons written, and first-try coverage — how much of a *new* app its
first rebuild gets right — for the last five apps against the five before.
That number rising is the evidence it can build more things than before.

## Sources

- **One of your projects**: anything in your project list.
- **A Git repository**: any public `https://` repository; it is cloned
  (shallow) into `builds/`. Its licence is read: code without an open licence
  teaches general lessons only and is never kept as an example.

Rebuilds are private study copies in `builds/`; nothing is published. Apps go
one at a time, in a queue that survives restarts and waits while everything
is paused.

Settings: `RECONSTRUCT_MAX_ROUNDS` (default 3), `RECONSTRUCT_BUILD_LIMIT_MS`
(one rebuild, default 4 h). Test: `npm run test:reconstruct`.
