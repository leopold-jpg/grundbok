import { createHash } from "node:crypto";
import type { Proposal } from "./proposal-contract";

/**
 * Kanoniserad JSON — kontraktets serialiseringsregel (ADR-0002):
 * nycklar sorterade rekursivt, belopp som heltal i ören, ingen whitespace.
 * EXAKT samma funktion körs på agent- och kärnsida; en agent som
 * serialiserar annorlunda får sin hash underkänd.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Förslagets hash: sha256 av kanoniserad payload UTAN hash-fältet.
 * Beslutet (mänskligt eller policy) binds till denna — ändras en enda
 * konteringsrad efter beslutet är beslutet ogiltigt.
 */
export function hashProposal(proposal: Omit<Proposal, "hash"> | Proposal): string {
  const { hash: _utelamnad, ...utanHash } = proposal as Proposal;
  return sha256Hex(canonicalJson(utanHash));
}

export function verifyProposalHash(proposal: Proposal): boolean {
  return hashProposal(proposal) === proposal.hash;
}
