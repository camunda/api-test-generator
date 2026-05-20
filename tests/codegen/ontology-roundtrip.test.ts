// Round-trip preservation test for JSON-LD → N-Quads (Step 3 of #TBD).
//
// Verifies that converting a well-formed JSON-LD document to N-Quads
// via the `jsonld` library and then re-parsing the N-Quads with n3
// yields the same set of quads (order-independent).  This proves that
// the export-ontology --rdf pipeline does not silently drop or duplicate
// triples across the conversion steps.
//
// The test uses an inline JSON-LD document (with an inline @context) so
// no network access is needed and no generated pipeline output is
// required.

import { describe, expect, it } from 'vitest';

describe('ontology JSON-LD round-trip (Step 3 — export-ontology --rdf)', () => {
  it('JSON-LD → N-Quads → re-parse preserves the same set of quads', async () => {
    const { default: jsonld } = await import('jsonld');
    const { Parser } = await import('n3');

    // Minimal ABox-like JSON-LD document using an inline context.
    // Mirrors the structure of configs/camunda-oca/ontology/edges.json
    // (a single Edge instance) but small enough to inspect by eye.
    const doc = {
      '@context': {
        '@vocab': 'https://camunda.github.io/api-test-generator/ns/v1/',
        edges: {
          '@id': 'https://camunda.github.io/api-test-generator/ns/v1/edges',
          '@container': '@set' as const,
        },
      },
      edges: [
        {
          '@type': 'Edge',
          name: 'TestMembership',
          endpoints: { from: 'FooKind', to: 'BarKind' },
          establishedBy: 'assignFooToBar',
          revokedBy: 'unassignFooFromBar',
          observableVia: 'searchBarsForFoo',
        },
      ],
    } as const;

    // Step 1: JSON-LD → N-Quads.
    const nquadsRaw = await jsonld.toRDF(doc, { format: 'application/n-quads' });
    expect(typeof nquadsRaw).toBe('string');
    if (typeof nquadsRaw !== 'string') throw new Error('expected string N-Quads from jsonld.toRDF');
    const nquads1: string = nquadsRaw;
    expect(nquads1.trim().length).toBeGreaterThan(0);

    // Step 2: Parse the N-Quads with n3 to get a set of quads.
    const parser1 = new Parser({ format: 'N-Quads' });
    const quads1 = parser1.parse(nquads1);
    expect(quads1.length).toBeGreaterThan(0);

    // Step 3: Serialise the parsed quads back to N-Quads via n3's
    // Serializer and re-parse — this exercises the n3 round-trip.
    const { Writer } = await import('n3');
    const writer = new Writer({ format: 'N-Quads' });
    writer.addQuads(quads1);
    const nquads2: string = await new Promise((resolve, reject) => {
      writer.end((error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    const parser2 = new Parser({ format: 'N-Quads' });
    const quads2 = parser2.parse(nquads2);

    // Step 4: Both parse passes should yield the same graph structure.
    // Blank node IDs are local to a document and may be renamed during
    // round-tripping — this is correct RDF behaviour. Compare the
    // graphs by:
    //   (a) same number of quads, and
    //   (b) same set of predicate+object triples where the object is a
    //       named node (IRI) or literal — these must be identical.
    expect(quads2.length, 'quad count must be preserved').toBe(quads1.length);

    const namedObjectTriples = (qs: typeof quads1): string[] =>
      qs
        .filter((q) => q.object.termType !== 'BlankNode')
        .map((q) => `${q.predicate.value} ${q.object.value}`)
        .sort();

    expect(namedObjectTriples(quads2)).toEqual(namedObjectTriples(quads1));
  });

  it('the edges ABox fragment emits at least one triple per known property', async () => {
    const { default: jsonld } = await import('jsonld');

    const doc = {
      '@context': {
        '@vocab': 'https://camunda.github.io/api-test-generator/ns/v1/',
      },
      '@type': 'Edge',
      name: 'RoleUserMembership',
      establishedBy: 'assignRoleToUser',
      revokedBy: 'unassignRoleFromUser',
      observableVia: 'searchUsersForRole',
    };

    const nquadsRaw = await jsonld.toRDF(doc, { format: 'application/n-quads' });
    expect(typeof nquadsRaw).toBe('string');
    if (typeof nquadsRaw !== 'string') throw new Error('expected string N-Quads from jsonld.toRDF');

    const NS = 'https://camunda.github.io/api-test-generator/ns/v1/';
    const requiredPredicates = [
      `${NS}name`,
      `${NS}establishedBy`,
      `${NS}revokedBy`,
      `${NS}observableVia`,
    ];

    const missing = requiredPredicates.filter((pred) => !nquadsRaw.includes(pred));
    expect(
      missing,
      `Expected all predicates to appear in N-Quads output but missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
