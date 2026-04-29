# Second-API sketch — GitHub Issues + Pull Requests

> Paper exercise per the spike brief. Goal: verify that the core
> ontology in [`ontology/core.ttl`](./ontology/core.ttl) accommodates a
> second API's concepts without invasive changes. **Not implemented —
> not loaded into the store, not queried.** A genuine sketch.

## Why this API

GitHub's Issues + Pull Requests REST API is a useful second test
because:

- It has runtime state dependencies (a PR cannot be merged before it's
  opened; a comment cannot be added to a closed conversation; a review
  cannot be requested on a draft PR until it's marked ready).
- It has identifiers whose validity depends on state (a `pull_number`
  is only valid for the lifetime of a PR; a `review_id` is only valid
  while the PR exists).
- It has artifact-shaped inputs (the diff content of a commit, similar
  in role to BPMN content for `createDeployment`).
- It is publicly documented and we already use it in three other repos
  in the workspace, so we can be honest about whether the abstraction
  fits.

## Vocabulary file (would-be `github.ttl`)

```turtle
@prefix github: <https://api.github.com/api-test-generator/github#> .
@prefix core:   <https://camunda.io/api-test-generator/core#> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .

# --- Identifiers (instances of core:Identifier) -------------------------
github:RepoFullName a core:Identifier ;
    rdfs:label "Repository full name (owner/repo)" ;
    core:validityState github:RepositoryExists .

github:IssueNumber a core:Identifier ;
    core:validityState github:IssueExists .

github:PullNumber a core:Identifier ;
    core:validityState github:PullRequestExists .

github:CommitSha a core:Identifier ;
    core:validityState github:CommitExists .

# --- Runtime states ----------------------------------------------------
github:RepositoryExists a core:RuntimeState ;
    core:hasParameter "fullName" .

github:IssueExists a core:RuntimeState ;
    core:hasParameter "issueNumber" ;
    core:dependsOn github:RepositoryExists .

github:PullRequestExists a core:RuntimeState ;
    core:hasParameter "pullNumber" ;
    core:dependsOn github:RepositoryExists .

github:PullRequestReadyForReview a core:RuntimeState ;
    core:dependsOn github:PullRequestExists .

github:PullRequestMergeable a core:RuntimeState ;
    core:dependsOn github:PullRequestReadyForReview .

# --- Capabilities (subclass of core:RuntimeState) ----------------------
github:RepoHasBranch a core:Capability ;
    core:hasParameter "branchName" ;
    core:dependsOn github:RepositoryExists .

github:RepoHasIssueLabel a core:Capability ;
    core:hasParameter "labelName" ;
    core:dependsOn github:RepositoryExists .

# --- Artifact kinds ----------------------------------------------------
github:DiffArtifact a core:ArtifactKind .   # commit diff content
github:Markdown    a core:ArtifactKind .   # issue body, PR description
```

## Mechanical observations

### What fitted cleanly

| Concept | Mapped to | Notes |
|---|---|---|
| `pull_number`, `issue_number` | `core:Identifier` + `core:validityState` | Same shape as `ProcessInstanceKey → ProcessInstanceExists` |
| "Cannot merge a draft PR" | `core:RuntimeState` chain via `core:dependsOn` | `PullRequestMergeable → PullRequestReadyForReview → PullRequestExists → RepositoryExists` |
| Branch-existence as a precondition for `createPullRequest` | `core:Capability` | Same role as `ModelHasServiceTaskType` |
| Diff content as input | `core:ArtifactKind` | Same role as `bpmnProcess` |
| Repo full-name as a stable identifier | `core:Identifier` | Validity state pattern works |

### What surfaced a question (not necessarily a gap)

1. **Multi-parameter states.** GitHub's `IssueExists` is keyed by
   `(owner, repo, issue_number)`, not a single parameter. The current
   `core:hasParameter` schema is single-valued. This is the same gap
   the value-binding drift detector already surfaced for Camunda
   (`ProcessInstanceExists` legitimately needs both `processDefinitionId`
   and `processInstanceKey`). Recommended core extension: change
   `core:hasParameter` to be multi-valued (it already is in RDF — the
   constraint is only in our SHACL). Documented as a follow-up below;
   does NOT require a core schema change, only a SHACL relaxation.

2. **State transitions vs. terminal states.** Closing an issue or
   merging a PR transitions the resource to a different RuntimeState
   (`IssueClosed`, `PullRequestMerged`) that *consumes* the prior state
   rather than being additive. The current core ontology has
   `core:produces`, `core:implicitlyAdds`, and `core:dependsOn` but no
   notion of "this operation invalidates state X". The Camunda side has
   `cancelProcessInstance` which has the same shape and currently
   models it as a no-op (the produced state is just absent). This is a
   real abstraction gap, but the spike's existing model already lives
   with it for Camunda — so it is API-agnostic, not GitHub-specific.
   Recommended core extension: `core:invalidates` property; out of
   spike scope.

3. **Conditional branching on response state.** GitHub's
   `getPullRequest` returns a `mergeable` field that may be
   `null | true | false`. Some operations (auto-merge) only succeed
   when `mergeable: true`. The current ontology models scenario
   prerequisites as state-existence; "the response says X" is not
   currently first-class. This is also Camunda-relevant
   (`getJob.state == ACTIVATABLE` gates further work), so again
   API-agnostic — not a gap exposed by the second-API exercise alone.

### What did NOT fit

Nothing. The exercise produced no concept that demanded an invasive
change to the core ontology. Two SHACL relaxations and one optional
new property (`core:invalidates`) cover everything; all three are
genuinely API-agnostic findings rather than GitHub-specific holes.

## Honest test for the abstraction (per the brief)

> "Can the planner be written referring only to terms in `core:`?"

Tracing the planner's actual call sites against the
[façade-derived indexes](./parity/index-parity.ts) and the
[scenario-chain candidate query](./queries/minimal-scenario-chain.ts):

- `bySemanticProducer[type]` — uses only `core:produces`,
  `core:authoritativeProducer`, `core:operationId`. No Camunda terms.
- `domainProducers[state]` — uses only `core:producesState`,
  `core:operationId`. No Camunda terms.
- `gatherDomainPrerequisites(seeds)` — replaceable by `core:dependsOn+`
  property path. No Camunda terms.
- Value-binding resolution — uses only `core:ValueBinding`,
  `core:bindsFromFieldPath`, `core:bindsToState`,
  `core:bindsToParameter`, `core:hasParameter`. No Camunda terms.

**Verdict: yes, the planner is API-agnostic in the proposed shape.**
The abstraction line (per-API adapters; API-agnostic graph store and
planner) is structurally achievable. This is a finding worth recording
even independently of whether RDF specifically is the carrier — the
named entities are the right ones.

## Boundary-clarity finding

The `camunda:` vocabulary file
([`ontology/camunda.ttl`](./ontology/camunda.ttl)) introduces only
*instances* and one `rdfs:subClassOf` relationship
(`core:Capability rdfs:subClassOf core:RuntimeState`, but that's
declared in core anyway). It introduces zero new properties. The
`github.ttl` sketch above does the same. That is the strongest signal
the boundary is in the right place: a per-API vocabulary is a list of
*what exists in this API*, not *new ways APIs can be shaped*.

If a per-API vocabulary ever needs a new property, that is the signal
that the core ontology is missing an abstraction.
