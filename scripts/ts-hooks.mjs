// Lets plain `node` run the TypeScript in src/ the way the bundlers do.
//
// Every relative import in this project names a `.js` file, which is the
// TypeScript convention for ESM and the only spelling Vercel's function build
// emits correctly — it compiles `src/**` to `.js` and copies the specifiers
// through untouched, so a `.ts` specifier becomes a module that is not there.
//
// Node disagrees. It strips types happily enough, but it will not resolve
// `./constants.js` to `constants.ts`: the file has to exist under the name it
// was asked for. So `npm run verify` and `npm run live`, which import
// `src/core` directly and are the scripts that hold the project's one hard
// claim up, could not load a thing.
//
// This is that one rule and nothing else: when a relative `.js` specifier does
// not exist on disk and the matching `.ts` does, resolve to the `.ts`. It is
// deliberately narrow — no transpiling, no caching, no path mapping. Node's own
// type stripping does the rest.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.endsWith(".js") &&
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL !== undefined
  ) {
    const asked = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(asked))) {
      const source = new URL(`${specifier.slice(0, -".js".length)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(source))) return await nextResolve(source.href, context);
    }
  }
  return await nextResolve(specifier, context);
}
