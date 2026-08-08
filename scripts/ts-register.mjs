// Loaded with `node --import ./scripts/ts-register.mjs`, which installs the
// resolver in `ts-hooks.mjs` before the script itself is loaded.
//
// Two files rather than one because Node runs resolver hooks on their own
// thread: a module that both registers a hook and exports it would register
// itself again over there.

import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);
