import type { PGlite } from "@electric-sql/pglite";
import { handleProposal } from "./decisions";
import { verifieraAgentNyckel } from "./agent-auth";

// HTTP-porten för POST /api/proposals som testbar funktion (WP8):
// routen är bara en tunn adapter runt denna. Statusskillnaden är
// medveten: okänd nyckel → 401; känd men pausad/avslutad agent → 403.

export type PortSvar = { http: number; body: unknown };

export async function proposalsPort(
  db: PGlite,
  authorizationHeader: string | null,
  raw: unknown,
): Promise<PortSvar> {
  const auth = await verifieraAgentNyckel(db, authorizationHeader);
  if (auth.typ === "okand") {
    return {
      http: 401,
      body: { fel: ["giltig agentnyckel krävs (Authorization: Bearer gk_…)"] },
    };
  }
  if (auth.typ === "inaktiv") {
    return {
      http: 403,
      body: {
        fel: [
          `agenten är ${auth.status === "paused" ? "pausad" : "avslutad"} — kontakta er konsult`,
        ],
      },
    };
  }

  if (raw === null || raw === undefined) {
    return { http: 400, body: { fel: ["ogiltig JSON"] } };
  }

  const resultat = await handleProposal(db, auth.principal, raw);
  switch (resultat.status) {
    case "avvisad_vid_porten":
      return { http: resultat.http, body: { fel: resultat.fel } };
    case "duplicate":
      return { http: 200, body: resultat };
    case "pending":
      return { http: 202, body: resultat };
    case "auto_approved":
      return { http: 201, body: resultat };
  }
}
