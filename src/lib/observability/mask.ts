// Maskering för Langfuse-export (obligatorisk): ALLOWLIST, inte denylist.
// Endast beslutsmetadata, flagg-identiteter, konfidens, promptversion
// (mall_id + mall_version + prompt_hash), tokens och latens lämnar
// processen omaskerade. Allt annat — underlagstext, motpartsnamn, belopp,
// frisvar — ersätts med [MASKERAT]. Ett nytt fält är alltså maskerat tills
// någon aktivt beslutar motsatsen; ett glömt fält kan aldrig läcka.
//
// Maskeringen sitter i LangfuseSpanProcessor (en enda tvingande punkt för
// input/output på varje observation) — anropsplatserna får skicka riktig
// data och kan aldrig kringgå den. OBS: metadata flattas av SDK:n till
// egna attribut (langfuse.observation.metadata.<nyckel>) som processorns
// mask-krok INTE når — metadata får därför ENBART bära identifierare ur
// allowlisten nedan, aldrig innehåll.

export const MASKERAT = "[MASKERAT]";

/** Nycklar vars primitiva värden får exporteras omaskerade. Booleans
 *  passerar alltid (kan inte bära innehåll); strängar/tal endast härifrån. */
const SAKRA_NYCKLAR = new Set<string>([
  // Identitet & routing (uuid:er och fasta identifierare)
  "tenant_id",
  "agent_id",
  "module",
  "id",
  "proposal_id",
  "document_id",
  "job_id",
  "payload_ref",
  "input_refs", // "fraga:<sha256>"/dokument-uuid — referenser, ej innehåll
  // Motor & modell. OBS: motor_detalj är MEDVETET inte med — den kan bära
  // API-felmeddelanden (okontrollerad text) i degraderingsvägen.
  "motor",
  "model",
  "stop_reason",
  "role", // fast vokabulär (user/system/assistant) — kan inte bära innehåll
  // Promptversion (kravet: mall_id + mall_version + prompt_hash)
  "mall_id",
  "mall_version",
  "prompt_hash",
  "module_version",
  "korpus_version",
  "contract_version",
  // Beslutsmetadata (enum-låsta/fasta värden — kan inte bära fritext)
  "status",
  "utfall",
  "kind",
  "kategori",
  "betalsatt",
  "konto",
  "niva",
  "lagrum", // lagrumsreferens ("BFL 5 kap 7 §") — aldrig kunddata
  "ruleset",
  // Korpusmetadata (versionerad intern kunskapsbas, ej kunddata)
  "skill",
  "version",
  "rubrik",
  // Mått (räknare/längder — aldrig belopp; beloppsnycklar *_ore saknas
  // medvetet här och maskeras därmed alltid)
  "konfidens",
  "confidence",
  "poang",
  "antal_fynd",
  "antal_traffar",
  "underlag_langd",
  "fraga_langd",
  "max_tokens",
]);

function maskeraVarde(varde: unknown, nyckelSaker: boolean): unknown {
  if (varde === null || varde === undefined || typeof varde === "boolean") {
    return varde;
  }
  if (
    typeof varde === "string" ||
    typeof varde === "number" ||
    typeof varde === "bigint"
  ) {
    return nyckelSaker ? varde : MASKERAT;
  }
  if (Array.isArray(varde)) {
    // Elementen ärver nyckelns status: input_refs: ["fraga:<hash>"] hålls,
    // medan objekt-element avgörs per fält i objektgrenen nedan.
    return varde.map((e) => maskeraVarde(e, nyckelSaker));
  }
  if (typeof varde === "object") {
    const ut: Record<string, unknown> = {};
    for (const [nyckel, v] of Object.entries(varde as Record<string, unknown>)) {
      ut[nyckel] = maskeraVarde(v, SAKRA_NYCKLAR.has(nyckel));
    }
    return ut;
  }
  // Funktioner/symboler och andra icke-serialiserbara värden.
  return MASKERAT;
}

/** Maskerar godtycklig payload-struktur. Rot-primitiver (t.ex. input satt
 *  till en råtextsträng) maskeras alltid — de saknar nyckel att lita på. */
export function maskera(data: unknown): unknown {
  return maskeraVarde(data, false);
}

/**
 * Mask-kroken för LangfuseSpanProcessor. Processorn skickar attributvärdet
 * som det står på spannet — för input/output en JSON-serialiserad sträng.
 * Kroken får ALDRIG kasta (processorn skulle själv helmaska, men vi vill
 * inte förlita oss på det) och faller alltid tillbaka till helmaskning.
 */
export function maskeraLangfuseAttribut(data: unknown): unknown {
  try {
    if (typeof data === "string") {
      try {
        return JSON.stringify(maskera(JSON.parse(data)));
      } catch {
        // Ingen giltig JSON — rå sträng kan vara vad som helst: helmaska.
        return MASKERAT;
      }
    }
    return maskera(data);
  } catch {
    return MASKERAT;
  }
}
