# C# Semantic Type Automation Boundary

This note captures which parts of the C# semantic type system can be generated from
OpenAPI `x-semantic-type` annotations, and which parts are intentionally manual.

## What a generator can safely do

- Emit `readonly record struct` wrappers for every `x-semantic-type` in the spec.
- Generate implicit conversions to and from `string` for ergonomic interop with
  JSON and API payloads.
- Generate `ToString()` forwarding to the underlying `Value`.
- Group the generated types by domain (identifiers, keys, ids) in a single file
  or a small file set.

These choices are structural and do not require human policy decisions.

## What should remain manual

- **Type naming policy**: mapping `x-semantic-type` values to C# type names
  (e.g., `ProcessDefinitionId` vs `ProcessDefinitionKey`) is mechanical, but
  exceptions and aliases should be human-reviewed.
- **Nullability and default handling**: deciding when a type should be nullable
  in DTOs is domain-specific and not always derivable from the schema alone.
- **API surface choices**: whether to include implicit conversions, explicit
  `Parse`/`TryParse`, or validation checks is a usability decision that should
  be reviewed by maintainers.
- **Packaging and namespaces**: project layout, namespace prefixes, and file
  organization are repo conventions, not spec-derived data.

## Recommended split of responsibilities

| Area | Generator responsibility | Manual responsibility |
| --- | --- | --- |
| Value struct type list | Create one type per `x-semantic-type` | Rename or alias any type that is confusing or deprecated |
| Conversions + `ToString()` | Generate standard conversions | Decide if stricter parsing or validation is needed |
| DTO field typing | Use generated types where `x-semantic-type` exists | Override nullability or apply domain rules |
| Project structure | None | Decide file layout, namespaces, and packaging |

## Practical guidance

- Generate the initial `Identifiers.cs` file from the spec, then review and
  curate it by hand for naming and nullability policy.
- Keep any manual edits in a separate patch or file so future regenerations
  can be reviewed cleanly.
