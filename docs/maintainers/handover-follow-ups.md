# Handover follow-ups

Work that is still open after the handover to the Hub team. The guides describe the end state ("`hub-medic` covers
the generator and pipeline"); this page lists what has to change in code before that is true.

## Point the generator alerts at `hub-medic`

**Why.** The Hub team owns the generator after the handover, so `hub-medic` should get the alerts that still ping
`test-automation-medic`.

**Code to change** (the Slack group `hub-medic` is already defined in both files; no new group id is needed):

| File | What |
|---|---|
| `.github/workflows/hub-pr-check.yml` | `ta_medic` is defined twice (search for `ta_medic=`). Used by the PR-check Slack alerts |
| `scripts/triage/hub-triage-format-slack.sh` | `def test_automation_medic`. Used by the nightly triage digest: a generator fix PR, a suppress PR, or a failure the triage could not classify |
| `.github/workflows/hub-pr-check.yml` (the "3 times today" message) | The text names `test-automation-medic`; change the name with the ping |

**The generator-gap alert ("api-test-generator not yet handling a new/changed endpoint")** should ping `hub-medic`. The PR author
acts first: the `Generator gap on camunda-hub#N` issue is assigned to them. `hub-medic` is the backup and the visibility. If
this turns out to be noisy, ping only when the gap is still open after the PR merges (the daily gap digest already lists
those). An engine change is an escalation to `#ask-qa`, not a reason to page `test-automation-medic` first.

**Watch for.**
- Some alerts already ping both groups (startup failure, high-confidence product failure). After the switch, drop the
  duplicate so `hub-medic` is pinged once.
- Tests may assert the exact Slack text. Run the triage and PR-check tests after the change.
- Decided: `test-automation-medic` stays, for faults only the enablement team can fix (the Vault, the Slack bot). Every
  generator and Hub alert goes to `hub-medic`. The nightly guide already describes it this way.

**Docs to change in the same PR**, so they agree with the code:
- `docs/how-it-works.md`: the line "Some alerts still ping `test-automation-medic`..."
- `docs/hub-nightly-cookbook.md`: the same note in "Start here", the "Pings" list, and "Who to ask"
- `docs/hub-pr-check-cookbook.md`: the "Medic" glossary entry and the "Who owns what" pointer
- `docs/maintainers/hub-pr-check-reference.md`: the "who gets told what" table and the "3 times" rule
- `AGENTS.md`: the line about the failure counter (search for `test-automation-medic`)

Delete this section when it is done.

## Ping `hub-medic` from the three owner posts

**Why.** The spec-bump alert, the re-enable check and the weekly coverage report are plain Slack posts. They mention no
group, and the PRs and issues they open (`spec-bump-open-pr.sh`, `hub-reenable-check.sh`, the coverage issue scripts)
have no assignee or reviewer. This worked while the owners read the channel; a new owner may not.

**Change.** Add a `hub-medic` mention to those three Slack messages, and consider a default reviewer on the PRs they open.
Keep each post silent when there is nothing to report. Update "Nobody is pinged for these three" in
`docs/hub-nightly-cookbook.md` in the same PR.

