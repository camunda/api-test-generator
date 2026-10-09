# Config files in `configs/camunda-hub/`

The files the nightly and re-enable guides refer to. Detail behind [the nightly guide](../hub-nightly-cookbook.md).

- `positive-suppress.json`: operations left out of the positive suite (key `suppress`).
- `request-validation.json`: settings for the negative suite. `excludeOperations` leaves operations out. `knownIssues` lists suite-wide skips with their Hub issue. `knownProblemDetailShapeGaps` lists the partly checked items. `"acknowledgedNotPlanned": true` on a `knownIssues` entry says Hub will not fix it, so the re-enable alert stops.
- `spec-pin.json`: the pinned Hub commit.
