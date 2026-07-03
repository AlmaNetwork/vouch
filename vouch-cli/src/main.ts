#!/usr/bin/env bun
// The `vouch` executable — parse argv, run, exit with the returned code.

import { run } from "./cli";

const code = await run(process.argv.slice(2), process.env, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
process.exit(code);
