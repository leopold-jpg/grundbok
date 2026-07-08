import { createHash } from "node:crypto";

// uuid v5 (RFC 4122, sha1-baserad, deterministisk). Workern deriverar
// proposal.id ur job_id (WP9): omkörning av samma jobb ger samma uuid →
// handleProposals idempotensnyckel gör om-körningar till dubbletter,
// aldrig dubbelbokföringar.

export const GRUNDBOK_JOBB_NAMESPACE = "8f6c1a2e-4d3b-5c70-9e21-6b0f4a7d9c15";

export function uuidv5(name: string, namespace: string = GRUNDBOK_JOBB_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (ns.length !== 16) throw new Error("namespace måste vara ett uuid");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
