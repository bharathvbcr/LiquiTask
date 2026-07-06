#!/usr/bin/env node
// Differential oracle for the TS -> Rust migration.
//
// For every service case in ./services/*.js it fuzzes thousands of inputs and
// asserts that `reference` (the ORIGINAL TypeScript logic, types stripped) and
// `port` (a JS mirror of the Rust in crates/liquitask-core) agree exactly. This
// proves the Rust ports are behaviour-preserving even though `cargo` cannot run
// in every environment.
//
// Run:  TZ=UTC node scripts/rust-migration-oracle/run.js
// (run.js re-execs itself under TZ=UTC so JS Date getters match the Rust UTC
//  civil-date math.)

"use strict";
const fs = require("fs");
const path = require("path");

if (process.env.TZ !== "UTC") {
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, TZ: "UTC" },
  });
  process.exit(r.status ?? 1);
}

// Deterministic RNG so runs are reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stableStringify(v) {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
    }
    return val;
  });
}

const servicesDir = path.join(__dirname, "services");
const files = fs.existsSync(servicesDir)
  ? fs.readdirSync(servicesDir).filter((f) => f.endsWith(".cjs")).sort()
  : [];

let totalCases = 0;
let totalMismatch = 0;
const summaries = [];

for (const file of files) {
  const mod = require(path.join(servicesDir, file));
  const cases = [];
  if (typeof mod.cases === "function") cases.push(...mod.cases());
  if (typeof mod.fuzz === "function") {
    const rng = mulberry32(0x1234abcd);
    for (const c of mod.fuzz(rng)) cases.push(c);
  }

  let mism = 0;
  const examples = [];
  for (const c of cases) {
    let refOut, portOut, err;
    try {
      refOut = stableStringify(mod.reference(...c.args));
    } catch (e) {
      err = "reference threw: " + e.message;
    }
    try {
      portOut = stableStringify(mod.port(...c.args));
    } catch (e) {
      err = (err ? err + "; " : "") + "port threw: " + e.message;
    }
    totalCases++;
    if (err || refOut !== portOut) {
      mism++;
      totalMismatch++;
      if (examples.length < 5) {
        examples.push({ label: c.label, err, ref: refOut, port: portOut });
      }
    }
  }

  const ok = mism === 0;
  summaries.push({ name: mod.name || file, count: cases.length, mism, ok });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${(mod.name || file).padEnd(34)} ${cases.length} cases` +
      (ok ? "" : `  (${mism} mismatches)`),
  );
  for (const ex of examples) {
    console.log(`   ↳ ${ex.label}`);
    if (ex.err) console.log(`     ${ex.err}`);
    else console.log(`     ref=${ex.ref}\n     port=${ex.port}`);
  }
}

console.log(
  `\n${totalMismatch === 0 ? "ALL PASS" : "MISMATCHES"}: ${files.length} service(s), ` +
    `${totalCases} cases, ${totalMismatch} mismatch(es).`,
);
process.exit(totalMismatch === 0 ? 0 : 1);
