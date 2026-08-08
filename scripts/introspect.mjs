#!/usr/bin/env node
// Writes src/data/schema.json from the live indexer. Ponder derives its root
// query field names from ponder.schema.ts, so the exact spelling is not
// guessable — every GraphQL document in this app is written against the output
// of this script, never against an assumption.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.basepaint.xyz";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/schema.json");

const QUERY = `
{
  __schema {
    queryType {
      fields {
        name
        args { name type { kind name ofType { kind name } } }
        type { kind name ofType { kind name } }
      }
    }
  }
}`;

async function introspect() {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });

  if (!res.ok) {
    throw new Error(`${ENDPOINT} returned ${res.status} ${res.statusText}`);
  }

  const { data, errors } = await res.json();
  if (errors) throw new Error(JSON.stringify(errors, null, 2));
  if (!data?.__schema?.queryType?.fields) {
    throw new Error("introspection returned no query fields");
  }
  return data;
}

/** Introspect one named type so we can see the exact field and argument shapes. */
async function introspectType(name) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        query T($name: String!) {
          __type(name: $name) {
            name
            kind
            inputFields { name type { kind name ofType { kind name } } }
            fields {
              name
              type { kind name ofType { kind name ofType { kind name } } }
              args { name type { kind name ofType { kind name } } }
            }
          }
        }`,
      variables: { name },
    }),
  });
  const { data, errors } = await res.json();
  if (errors) throw new Error(JSON.stringify(errors, null, 2));
  return data.__type;
}

const schema = await introspect();
const fields = schema.__schema.queryType.fields;

console.log("Root query fields:\n");
for (const field of fields) {
  const args = field.args.map((a) => a.name).join(", ");
  console.log(`  ${field.name}(${args})`);
}

// The stroke feed and the per-day canvas record are the only two things this
// app reads; dump their shapes so queries.ts can be written against fact.
const interesting = fields
  .map((f) => f.name)
  .filter((n) => /^(stroke|canvas|account|contribution)s?$/i.test(n));

const types = {};
for (const name of ["Stroke", "Canvas", "StrokeFilter", "StrokePage"]) {
  const type = await introspectType(name);
  if (type) types[name] = type;
}

console.log("\nMatching root fields for this app:", interesting.join(", ") || "(none)");
for (const [name, type] of Object.entries(types)) {
  const shape = (type.fields ?? type.inputFields ?? []).map((f) => f.name).join(", ");
  console.log(`\n${name} (${type.kind}): ${shape}`);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ ...schema, types }, null, 2)}\n`);
console.log(`\nwrote ${OUT}`);
