# Working conventions

## Project architecture

The project architecture can be found in `docs/architecture.md`. If any code you are working on or have already implemented does not match what is described there, then either the code is wrong or the architecture needs to be updated. If the architecture needs to be updated, then you should check in with the human to confirm the reason for the change.

The architecture document should act as a reference for how to implement the various parts of the project. It should not act as a scratchpad for writing notes or tracking progress

## Code style

### Comments

Code comments should only be used to explain why a particular implementation decision was made. They should be rare. Their purpose should be to help future maintainers understand the context of the code so that they can make informed decisions about how to work with it

If you need to write a comment, then you should aim to make it as clear and concise as possible. Avoid referencing documentation as this is prone to become stale.

## Tests

Always use test-driven development when working on code in this repository

Put `*.test.ts` (and `*.test.tsx`) next to the file it tests, one test file per source file —
e.g. `http.ts` → `http.test.ts`, not a shared `index.test.ts` covering the whole package. A single
catch-all test file grows unbounded and stops mapping to any one unit of code. This matches
`docs/architecture.md` §6.4.
