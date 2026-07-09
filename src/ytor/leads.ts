import type { PGlite } from "@electric-sql/pglite";

// Publika sajtens kontaktbox (WP12). Leads är operatörens data och går
// service-vägen — de tillhör ingen tenant. Ytlogik bor i src/ytor/
// (kärnan i src/lib är fryst i S2).

export type NyLead = {
  namn: string;
  byra: string;
  email: string;
  meddelande?: string;
};

const MAX_FALT = 200;
const MAX_MEDDELANDE = 4000;

/** Validerar ett inkommande lead. Returnerar felet på svenska, eller null. */
export function valideraLead(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return "ogiltig JSON";
  const { namn, byra, email, meddelande } = input as Record<string, unknown>;
  if (typeof namn !== "string" || !namn.trim()) return "namn krävs";
  if (typeof byra !== "string" || !byra.trim()) return "byrå krävs";
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return "en giltig e-postadress krävs";
  }
  if (meddelande !== undefined && typeof meddelande !== "string") {
    return "meddelandet måste vara text";
  }
  if (namn.length > MAX_FALT || byra.length > MAX_FALT || email.length > MAX_FALT) {
    return `fälten får vara högst ${MAX_FALT} tecken`;
  }
  if (typeof meddelande === "string" && meddelande.length > MAX_MEDDELANDE) {
    return `meddelandet får vara högst ${MAX_MEDDELANDE} tecken`;
  }
  return null;
}

export async function sparaLead(db: PGlite, lead: NyLead): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO leads (namn, byra, email, meddelande)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [lead.namn.trim(), lead.byra.trim(), lead.email.trim(), lead.meddelande?.trim() || null],
  );
  return { id: r.rows[0].id };
}
