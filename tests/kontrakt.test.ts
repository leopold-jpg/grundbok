import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProposalSchema,
  hashProposal,
  verifyProposalHash,
  canonicalJson,
  sha256Hex,
  type Proposal,
} from "../src/contracts";
import { exempelProposal } from "./helpers";

// WP1: kontraktet — zod-validering + kanoniserad hash. Detta är gränsen
// alla moduler (interna och OpenClaw-agenter) måste passera.

test("giltigt journal_entry-förslag passerar schema + hashverifiering", () => {
  const p = exempelProposal();
  const parsed = ProposalSchema.safeParse(p);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues));
  assert.ok(verifyProposalHash(p));
});

test("kanonisering: nyckelordning påverkar aldrig hashen", () => {
  const a = { b: 1, a: { d: [1, 2], c: "x" } };
  const b = { a: { c: "x", d: [1, 2] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("manipulerad rad → hashverifieringen faller", () => {
  const p = exempelProposal();
  const manipulerad: Proposal = {
    ...p,
    lines: p.lines.map((l, i) => (i === 0 ? { ...l, debet_ore: 1 } : l)),
  };
  assert.equal(verifyProposalHash(manipulerad), false);
});

test("obalanserat förslag avvisas av schemat", () => {
  const p = exempelProposal();
  const obalans = {
    ...p,
    lines: p.lines.map((l, i) => (i === 0 ? { ...l, debet_ore: 99 } : l)),
  };
  const parsed = ProposalSchema.safeParse({ ...obalans, hash: hashProposal(obalans) });
  assert.equal(parsed.success, false);
});

test("advisory_answer med konteringsrader avvisas", () => {
  const p = exempelProposal({ kind: "advisory_answer" });
  const parsed = ProposalSchema.safeParse(p);
  assert.equal(parsed.success, false);
});

test("advisory_answer utan rader passerar", () => {
  const p = exempelProposal({ kind: "advisory_answer", lines: [], module: "radgivning" });
  const parsed = ProposalSchema.safeParse(p);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues));
});

test("correction utan verifikationsreferens avvisas", () => {
  const p = exempelProposal({ kind: "correction" });
  assert.equal(ProposalSchema.safeParse(p).success, false);

  const medRef = exempelProposal({
    kind: "correction",
    provenance: {
      model: "claude-opus-4-8",
      prompt_hash: sha256Hex("x"),
      module_version: "0.2.0",
      input_refs: ["verification:00000000-0000-4000-8000-000000000002"],
      injection_screened: true,
    },
  });
  assert.ok(ProposalSchema.safeParse(medRef).success);
});

test("fel kontraktsversion avvisas", () => {
  const p = exempelProposal();
  const parsed = ProposalSchema.safeParse({ ...p, contract_version: "0.1.0" });
  assert.equal(parsed.success, false);
});

test("konto utanför BAS-klass 1–8 avvisas", () => {
  const p = exempelProposal();
  const fel = { ...p, lines: [{ ...p.lines[0], konto: "9999" }, p.lines[1], p.lines[2]] };
  assert.equal(ProposalSchema.safeParse({ ...fel, hash: hashProposal(fel) }).success, false);
});
