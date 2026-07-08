import { canonicalJson, sha256Hex } from "@/contracts/canonical";

// Policy-motorn är deterministisk kod UTANFÖR LLM:en (ULTRAPLAN §3).
// Mönstret lånar ClawKeepers evaluate-som-ren-funktion (MIT, se
// ATTRIBUTION.md) med två korrigeringar: godkännandet binds till en hash
// av exakt det förslag som godkändes (inte blind tillit till ett id),
// och injection-mönstren är svenska + engelska.

// Kanoniseringen bor i kontraktet (src/contracts/canonical.ts) — samma
// funktion på agent- och kärnsida. Re-exporteras här för v1-anropare.
export { canonicalJson } from "@/contracts/canonical";

/** SHA-256 av kanonisk JSON — förslagets identitet i godkännandeflödet. */
export function hashForslag(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

export type InjectionFynd = { monster: string; utdrag: string };

const INJECTION_MONSTER: { namn: string; re: RegExp }[] = [
  { namn: "ignorera_instruktioner_sv", re: /ignorera\s+(alla\s+)?(tidigare|föregående|ovanstående)\s+(instruktioner|regler)/i },
  { namn: "ignore_instructions_en", re: /ignore\s+(all\s+)?(previous|prior|system|developer)\s+instructions/i },
  { namn: "godkann_utan_granskning", re: /godkänn\s+(detta\s+)?(automatiskt|utan\s+granskning)/i },
  { namn: "bypass_sv", re: /kringgå\s+(godkännande|kontroll|policy|moms)/i },
  { namn: "bypass_en", re: /bypass\s+(approval|permissions|tenant|auth|policy)/i },
  { namn: "satt_belopp", re: /(sätt|ändra)\s+beloppet\s+till/i },
  { namn: "du_ar_nu", re: /du\s+är\s+nu\s+(en|ett)\s/i },
  { namn: "system_prompt", re: /system\s*prompt|systemprompt/i },
];

/**
 * Injection-kontroll av dokumentinnehåll FÖRE LLM-anropet. Ett kvitto är
 * untrusted input. Regexar är signalen, inte försvaret — det primära
 * försvaret är strukturellt: dokumentet ramas in som data (<dokument>-tagg)
 * och LLM-utdata valideras mot schema med enum-låsta kategorier.
 */
export function kontrolleraInjection(text: string): InjectionFynd[] {
  const fynd: InjectionFynd[] = [];
  for (const { namn, re } of INJECTION_MONSTER) {
    const m = text.match(re);
    if (m) fynd.push({ monster: namn, utdrag: m[0].slice(0, 80) });
  }
  return fynd;
}

export type PolicyBeslut =
  | { beslut: "tillat" }
  | { beslut: "neka"; skal: string };

export type PolicyInput = {
  handling: "tolka_dokument" | "foresla_kontering" | "registrera_verifikation" | "betalning";
  tenantId: string;
  kontextTenantId: string;
  roll: "klient" | "konsult";
  godkannande?: {
    beslut: "godkand" | "avvisad";
    suggestionHash: string;
    godkandAv: string;
  };
  aktuellForslagsHash?: string;
};

/**
 * Ren, testbar funktion — inga sidoeffekter, ingen databas. Enda vägen
 * till en bokförd verifikation går genom evaluate med giltigt godkännande.
 */
export function evaluate(input: PolicyInput): PolicyBeslut {
  // Tenant-match före allt annat: kund A:s data får aldrig nå kund B.
  if (input.tenantId !== input.kontextTenantId) {
    return {
      beslut: "neka",
      skal: `Tenant-isolering: handling för ${input.tenantId} i kontext ${input.kontextTenantId}`,
    };
  }

  switch (input.handling) {
    case "betalning":
      // Hårdblockerad i v1 — finns inte som handling, oavsett godkännande.
      return { beslut: "neka", skal: "Betalningar existerar inte som handling i v1 (ULTRAPLAN §3)" };

    case "tolka_dokument":
    case "foresla_kontering":
      return { beslut: "tillat" };

    case "registrera_verifikation": {
      if (input.roll !== "konsult") {
        return { beslut: "neka", skal: "Endast konsultrollen får registrera verifikationer (ansvarsprincipen)" };
      }
      const g = input.godkannande;
      if (!g || g.beslut !== "godkand") {
        return { beslut: "neka", skal: "Registrering kräver ett godkännandebeslut" };
      }
      if (!input.aktuellForslagsHash || g.suggestionHash !== input.aktuellForslagsHash) {
        return {
          beslut: "neka",
          skal: "Godkännandets hash matchar inte förslaget — förslaget har ändrats efter godkännandet",
        };
      }
      if (!g.godkandAv) {
        return { beslut: "neka", skal: "Godkännandet saknar identitet" };
      }
      return { beslut: "tillat" };
    }
  }
}
