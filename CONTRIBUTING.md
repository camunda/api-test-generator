# Contributing

## Test strategy: fixture + invariant rule

This repo uses a layered regression strategy (see [README §Regression Testing](README.md#regression-testing)).
There is no end-to-end snapshot guard; instead, we rely on small, named
fixtures and invariants that point directly at the broken property when
they fail.

**Standing rule for every bug-fix PR to the extractor or planner:**

1. **Add a fixture demonstrating the bug BEFORE the fix.**
   - Extractor bugs → a hand-curated minimal OpenAPI snippet in
     [tests/fixtures/extractor/](tests/fixtures/extractor) paired with a
     property assertion (`required`, `provider`, `fieldPath`, …).
   - Planner bugs → a hand-built minimal `OperationGraph` in
     [tests/fixtures/planner/](tests/fixtures/planner) paired with a
     chain-shape assertion on `generateScenariosForEndpoint`.

   The fixture should fail on `main` and pass on your branch. Each `it`
   block is one regression statement.

2. **Add an invariant if the property is observable at the chain or graph
   level on the real bundled spec.** Add it to
   [tests/regression/bundled-spec-invariants.test.ts](tests/regression/bundled-spec-invariants.test.ts).
   Use a named, human-readable assertion ("`createDeployment` provides
   the full `{...}` provider set"), not a generic structural diff.

This rule keeps the regression surface focused on properties that have a
known reason to be tested. It also keeps PR review costs low: a fixture
or invariant failure names the broken property directly, instead of
emitting a multi-hundred-file diff.

## Determinism

Generator output is byte-reproducible by default — `TEST_SEED` defaults
to `'snapshot-baseline'`. To opt out for live-broker exploration, set
`TEST_SEED=random`. See [README §Determinism](README.md#determinism).

## Spec pin

The bundled-spec invariants are evaluated against a pinned upstream spec
SHA recorded in [tests/regression/spec-pin.json](tests/regression/spec-pin.json).
If the bundled spec content drifts from the pin, the vitest globalSetup
in [tests/regression/spec-pin.setup.ts](tests/regression/spec-pin.setup.ts)
aborts the entire run with an actionable re-pin message. See
[README §Spec pin](README.md#spec-pin) for the bump procedure.
