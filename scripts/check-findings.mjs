// Fails if FINDINGS.md lacks a Verdict for S1-S5, links evidence that doesn't exist, or evidence/findings contain token-like strings.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs/spikes");
const findings = readFileSync(join(docs, "FINDINGS.md"), "utf8");
const errors = [];

// 1. one section per spike, each with a Verdict line
for (const n of [1, 2, 3, 4, 5]) {
  const m = new RegExp(`^## S${n}:[^\\n]*\\n([\\s\\S]*?)(?=^## S\\d:|$(?![\\s\\S]))`, "m").exec(findings);
  if (!m) { errors.push(`S${n}: section missing`); continue; }
  if (!/^- \*\*Verdict:\*\* (CONFIRMED WITH CHANGES|CONFIRMED|REPLACED)/m.test(m[1])) errors.push(`S${n}: no valid Verdict line`);
}

// 2. evidence links resolve
for (const [, link] of findings.matchAll(/\]\((evidence\/[^)#]*)\)/g)) {
  if (!existsSync(join(docs, link))) errors.push(`missing evidence file: ${link}`);
}

// 3. no secrets in findings or evidence
const patterns = [/\d{8,10}:[A-Za-z0-9_-]{35}/, /sk-ant-/, /eyJ[A-Za-z0-9_-]{10,}/, /sb_secret_[A-Za-z0-9_-]{10,}/];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of [join(docs, "FINDINGS.md"), ...walk(join(docs, "evidence"))]) {
  const text = readFileSync(f, "utf8");
  for (const p of patterns) if (p.test(text)) errors.push(`token-like string (${p}) in ${f.replace(root + "/", "")}`);
}

if (errors.length) { console.error(errors.map((e) => `FAIL ${e}`).join("\n")); process.exit(1); }
console.log("check-findings: OK (S1-S5 verdicts, evidence links, no token patterns)");
