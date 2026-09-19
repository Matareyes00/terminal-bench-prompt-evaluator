// Regresion del parseo de task.toml.
//
// Existe por un bug concreto: leer el primer `timeout_sec` del archivo agarra
// el de [verifier] (900) en vez del de [agent] (28800), y el check del trailer
// emite un blocker falso sobre runner-failure-visibility, que es uno de los
// dos positivos del corpus. Un falso positivo sobre un positivo es la falla
// que este proyecto existe para evitar, asi que queda cubierta.
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

test("toma [agent].timeout_sec, no el primer timeout_sec del archivo", () => {
  assert.equal(agentTimeout(REAL), 28800);
});

test("acepta enteros y decimales", () => {
  assert.equal(agentTimeout("[agent]\ntimeout_sec = 600"), 600);
  assert.equal(agentTimeout("[agent]\ntimeout_sec = 600.5"), 600.5);
});

test("sin seccion [agent] no inventa un valor", () => {
  assert.equal(agentTimeout("[verifier]\ntimeout_sec = 900.0"), undefined);
  assert.equal(agentTimeout(""), undefined);
});

test("no se lleva el timeout_sec de [verifier.environment]", () => {
  assert.equal(
    agentTimeout("[agent]\ntimeout_sec = 100\n\n[verifier.environment]\ntimeout_sec = 999"),
    100,
  );
});
