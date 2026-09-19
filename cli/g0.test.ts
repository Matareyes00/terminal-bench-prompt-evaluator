// Regression tests for task.toml parsing.
//
// These exist because of a concrete bug: reading the first `timeout_sec` in
// the file grabs [verifier]'s (900) instead of [agent]'s (28800), and the
// trailer check then emits a false blocker on runner-failure-visibility, one
// of the two corpus positives. A false positive on a positive is the failure
// this project exists to prevent, so it stays covered.
//
//   npx tsx --test cli/g0.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { agentTimeout } from "./g0.ts";

const REAL = `
schema_version = "1.4"

[verifier]
timeout_sec = 900.0
environment_mode = "separate"

[verifier.environment]
build_timeout_sec = 3600.0

[agent]
timeout_sec = 28800.0

[environment]
build_timeout_sec = 3600.0
`;

test("takes [agent].timeout_sec, not the first timeout_sec in the file", () => {
  assert.equal(agentTimeout(REAL), 28800);
});

test("accepts integers and decimals", () => {
  assert.equal(agentTimeout("[agent]\ntimeout_sec = 600"), 600);
  assert.equal(agentTimeout("[agent]\ntimeout_sec = 600.5"), 600.5);
});

test("invents no value when there is no [agent] section", () => {
  assert.equal(agentTimeout("[verifier]\ntimeout_sec = 900.0"), undefined);
  assert.equal(agentTimeout(""), undefined);
});

test("does not pick up [verifier.environment]'s timeout_sec", () => {
  assert.equal(
    agentTimeout("[agent]\ntimeout_sec = 100\n\n[verifier.environment]\ntimeout_sec = 999"),
    100,
  );
});
