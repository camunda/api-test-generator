# Glossary

Terms and config files used in the Hub guides. The short list is in "Words used" in
[hub-nightly-cookbook.md](../hub-nightly-cookbook.md); more are in [hub-pr-check-cookbook.md](../hub-pr-check-cookbook.md).

- **Invariant tests:** tests in this repo that check the generated output against the pinned spec. They guard the generator, not Hub.
- **Op-surface drift:** the set of operations in Hub's latest spec differs from the pin (some added or removed).
- **Auto-adopt:** the spec-bump job opening the PR that moves the pin when the new spec is safe. It still needs a person to merge.
- **Live check:** running the generated suite against a real Hub. `hub-ondemand-test` does it by hand.
- **Lifecycle test:** one test that creates, reads and deletes a resource in a row.
- **Gap digest:** a weekday 07:00 post in `#camunda-hub-pr-e2e-results` about generator gaps from merged camunda-hub PRs. Not part of the nightly channel.
- **TestRail:** the test-management tool the nightly results are also published to.
- **Vault:** the secrets store the workflows read their tokens from.

## Config files in `configs/camunda-hub/`

- `positive-suppress.json`: operations left out of the positive suite (key `suppress`).
- `request-validation.json`: settings for the negative suite. `excludeOperations` leaves operations out. `knownIssues` lists suite-wide skips with their Hub issue. `knownProblemDetailShapeGaps` lists the partly checked items. `"acknowledgedNotPlanned": true` on a `knownIssues` entry says Hub will not fix it, so the re-enable alert stops.
- `spec-pin.json`: the pinned Hub commit.
