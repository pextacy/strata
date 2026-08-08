import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import schema from "../src/data/schema.json" with { type: "json" };

/**
 * Every GraphQL document in the app, walked against the schema the indexer
 * actually published.
 *
 * `src/data/queries.ts` opens with a warning that Ponder pluralises by appending
 * "s", so the canvas list field is `canvass` and must not be "fixed". That is
 * the shape of the whole risk here: a field name that reads like a typo and is
 * not, or reads fine and is. Either way the only thing that notices is the
 * indexer, at runtime, in a browser — the tests reach no network by design and
 * CI never calls it, so a renamed field ships green and fails for everyone.
 *
 * `src/data/schema.json` is committed for exactly this reason. This reads it as
 * a schema rather than as a document: root fields, their arguments, and the type
 * every selection descends into, so `items { pixles }` is caught here instead of
 * in production.
 *
 * When a query needs a type this cannot resolve, the test fails rather than
 * skipping. Add the type to the list in `scripts/introspect.mjs`, re-run
 * `npm run introspect`, and commit what it writes.
 */

const SOURCE = readFileSync(new URL("../src/data/queries.ts", import.meta.url), "utf8");

// --- the schema, as a thing that can be asked questions ----------------------

interface TypeRef {
  readonly kind: string;
  readonly name: string | null;
  readonly ofType?: TypeRef | null;
}
interface Field {
  readonly name: string;
  readonly type: TypeRef;
  readonly args?: { readonly name: string; readonly type: TypeRef }[];
}
interface NamedType {
  readonly kind: string;
  readonly fields?: Field[] | null;
  readonly inputFields?: Field[] | null;
}

const ROOT: Field[] = schema.__schema.queryType.fields as unknown as Field[];
const TYPES = schema.types as unknown as Record<string, NamedType>;

/** Strips NON_NULL and LIST wrappers down to the named type underneath. */
function named(type: TypeRef | null | undefined): string | null {
  let current = type;
  while (current && current.name === null) current = current.ofType;
  return current?.name ?? null;
}

const fieldsOf = (type: string): string[] => {
  const found = TYPES[type];
  if (found === undefined) return [];
  return (found.fields ?? found.inputFields ?? []).map((f) => f.name);
};

// --- the queries, as trees ---------------------------------------------------

interface Selection {
  readonly name: string;
  readonly args: string[];
  readonly children: Selection[];
}

/** The selection set starting at `open`, which must index the opening brace. */
function parseSelections(text: string, open: number): { nodes: Selection[]; end: number } {
  const nodes: Selection[] = [];
  let i = open + 1;

  while (i < text.length) {
    const char = text[i];
    if (char === "}") return { nodes, end: i };
    if (/\s|,/.test(char)) {
      i++;
      continue;
    }

    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))?.[0];
    if (name === undefined) throw new Error(`unreadable token at ${i}: ${text.slice(i, i + 30)}`);
    i += name.length;

    const args: string[] = [];
    while (/\s/.test(text[i])) i++;
    if (text[i] === "(") {
      const close = matching(text, i, "(", ")");
      // Top-level `name:` pairs only — anything nested belongs to a value.
      for (const [, arg] of argPairs(text.slice(i + 1, close))) args.push(arg);
      i = close + 1;
    }

    let children: Selection[] = [];
    while (/\s/.test(text[i])) i++;
    if (text[i] === "{") {
      const inner = parseSelections(text, i);
      children = inner.nodes;
      i = inner.end + 1;
    }

    nodes.push({ name, args, children });
  }
  throw new Error("a selection set was never closed");
}

/** Index of the bracket that closes the one at `from`. */
function matching(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  throw new Error(`no closing ${close} for the ${open} at ${from}`);
}

/** `name:` pairs at brace depth 0 of an argument list, as [index, name]. */
function argPairs(text: string): [number, string][] {
  const out: [number, string][] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{" || char === "(" || char === "[") depth++;
    else if (char === "}" || char === ")" || char === "]") depth--;
    else if (char === ":" && depth === 0) {
      const before = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text.slice(0, i));
      if (before) out.push([i, before[1]]);
    }
  }
  return out;
}

/** The keys of an object literal passed to an argument, e.g. `where: { … }`. */
function objectKeys(argsText: string, argName: string): string[] {
  const at = new RegExp(String.raw`\b${argName}\s*:\s*\{`).exec(argsText);
  if (at === null) return [];
  const open = at.index + at[0].length - 1;
  const close = matching(argsText, open, "{", "}");
  return argPairs(argsText.slice(open + 1, close)).map(([, name]) => name);
}

interface Document {
  readonly constant: string;
  readonly text: string;
  readonly root: Selection;
  readonly rootArgsText: string;
}

/** Every `const NAME = \`query …\`` in queries.ts. */
function documents(): Document[] {
  const found: Document[] = [];
  for (const match of SOURCE.matchAll(/const ([A-Z_][A-Z0-9_]*) = `([\s\S]*?)`;/g)) {
    const [, constant, text] = match;
    if (!/^\s*query\b/m.test(text)) continue;
    const open = text.indexOf("{", text.indexOf("query"));
    const { nodes } = parseSelections(text, open);
    if (nodes.length !== 1) throw new Error(`${constant} has ${nodes.length} root fields`);
    const rootStart = text.indexOf(nodes[0].name, open);
    const paren = text.indexOf("(", rootStart);
    const brace = text.indexOf("{", rootStart);
    const rootArgsText =
      paren !== -1 && paren < brace ? text.slice(paren + 1, matching(text, paren, "(", ")")) : "";
    found.push({ constant, text, root: nodes[0], rootArgsText });
  }
  return found;
}

const DOCUMENTS = documents();

/** Which named type a selection's children belong to. */
function childType(parent: string | null, selection: Selection): string | null {
  if (parent === null) return null;
  const type = TYPES[parent];
  if (type === undefined) return null;
  const field = (type.fields ?? []).find((f) => f.name === selection.name);
  return field === undefined ? null : named(field.type);
}

// --- the checks --------------------------------------------------------------

describe("the app's GraphQL documents", () => {
  it("finds every query in queries.ts, so none can escape these checks", () => {
    expect(DOCUMENTS.map((d) => d.constant).sort()).toEqual([
      "ARTIST_ACCOUNT",
      "ARTIST_DAYS",
      "DAY_CANVAS",
      "DAY_STROKES",
      "DAY_STROKES_AFTER_ID",
    ]);
  });
});

describe.each(DOCUMENTS.map((d) => [d.constant, d] as const))("%s", (_name, document) => {
  const rootField = ROOT.find((f) => f.name === document.root.name);

  it("asks for a field the indexer's root query actually has", () => {
    // `canvass` is real and `canvases` is not — Ponder pluralises with a bare
    // "s". This is the check that says which.
    expect(
      rootField,
      `no root field named ${document.root.name}; the schema has ${ROOT.length} of them`,
    ).toBeDefined();
  });

  it("passes only arguments that field takes", () => {
    const allowed = (rootField?.args ?? []).map((a) => a.name);
    for (const arg of document.root.args) {
      expect(allowed, `${document.root.name} has no argument "${arg}"`).toContain(arg);
    }
  });

  it("filters on columns the filter type actually has", () => {
    const whereArg = (rootField?.args ?? []).find((a) => a.name === "where");
    const keys = objectKeys(document.rootArgsText, "where");
    if (keys.length === 0) return;
    const filter = named(whereArg?.type);
    expect(filter, "a where clause on a field with no filter type").not.toBeNull();
    expect(fieldsOf(filter as string), `${filter} was not captured by npm run introspect`).not.
      toHaveLength(0);
    for (const key of keys) {
      expect(fieldsOf(filter as string), `${filter} has no "${key}"`).toContain(key);
    }
  });

  it("selects only fields the types it descends into have", () => {
    const walk = (selections: readonly Selection[], type: string | null, path: string): void => {
      if (type === null) return;
      const available = fieldsOf(type);
      expect(
        available,
        `${type} is selected from at ${path} but npm run introspect never captured it`,
      ).not.toHaveLength(0);

      for (const selection of selections) {
        expect(available, `${type} has no field "${selection.name}" (${path})`).toContain(
          selection.name,
        );
        if (selection.children.length > 0) {
          const next = childType(type, selection);
          expect(
            next,
            `${path}.${selection.name} descends into a type the schema cannot name`,
          ).not.toBeNull();
          walk(selection.children, next, `${path}.${selection.name}`);
        }
      }
    };

    walk(document.root.children, named(rootField?.type), document.root.name);
  });
});
