# Kickoff — förhörschatten (WP40–WP43)

Mål: konsulten kan förhöra agenten om ett specifikt förslag,
direkt i attestpanelens detaljvy. Byggs i LAGER — varje lager
ska vara mergebart och demobart för sig. Läs
docs/PRODUKTNOTAT-forhorschatt.md först: rätt version, fel
version och säkerhetsramarna där gäller som krav.

Branch forhorschatt, utgå från main (git pull). En commit per
WP, npm test grönt mellan varje, adversariell granskning innan
PR. Öppna PR — merga inte. Blockeras du: stanna, dokumentera.

## WP40 — Lager 1: "Varför?"-panelen (deterministisk, INGEN LLM)

Utfällbar sektion i detaljpanelen som visar vad som redan finns:
- Agentens motivering + flaggor från förslaget
- Vilka branschpaketsregler som var aktiva (regel-id + namn)
- Konfidens och policyutfall (varför auto/granskning)
- De 3 senaste verifikaten/förslagen från samma motpart hos
  samma tenant (belopp, konto, datum, utfall)
Allt läses ur befintliga tabeller. Ingen LLM-runda, inga nya
kontraktsfält. Tangentbordsnåbar (V öppnar/stänger).
DETTA LAGER ÄR DEMO-GOLVET — det ska vara felfritt.

## WP41 — Lager 2: chatten

Fråga-fält under Varför-panelen. Flöde:
1. POST /api/byra/forhor { proposalId, fraga }
2. Servern bygger kontext STRIKT ur tenantens data (RLS):
   förslaget + underlagsobservationer (maskerat i telemetri
   som allt annat), motpartshistorik, aktiva paketregler,
   relevanta poster ur konteringsminnet
3. LLM-svar med källhänvisning per påstående (regel-id,
   verifikat-id, "agentens motivering")
4. Fråga + svar persisteras på förslaget i beslutsloggen
   (samma mönster som Fråga kunden-kedjan, WP33)
Guardrails i systemprompten: svara ENDAST utifrån given
kontext; skatteråd/framåtblickande rådgivning → hänvisa till
människa; okänt → säg "underlag saknas", gissa aldrig.
Kind: återanvänd advisory_answer (ingen kontraktsändring nu);
notera i koden att egen kind övervägs i v0.4.
Langfuse: egen trace-typ forhor, maskering enligt allowlisten.

## WP42 — Lager 3: polish + gränser

- Svarsstreaming eller tydlig laddindikator (max ~8s känsla)
- Felläge: LLM nere → panelen visar lager 1-datat + "chatten
  vilar, här är underlaget" — ALDRIG tom ruta eller 404
- Kostnadsvakt: max 20 frågor/tenant/dag (hårdkodad konstant,
  konfigurerbar senare), vänligt meddelande vid tak
- Feature-flagga FORHOR_CHAT_ENABLED (env): av → endast
  lager 1 syns. Demon kan alltså köras i valfritt läge.

## WP43 — test + smoke + rapport

- Golden: fråga om fall 2 (ÄTA) ska citera paketregeln; fråga
  om fall 1 (fel tenant) ska förklara mottagarkontrollen;
  fråga utanför kontext ("ska jag byta bolagsform?") ska
  hänvisa till människa
- RLS-test: förhör kan aldrig läsa annan tenants data
- Loggtest: fråga+svar syns i beslutsloggen på förslaget
- E2E: öppna förslag → V → ställ fråga → svar med källa →
  syns i logg
- docs/SESSIONSRAPPORT-forhorschatt.md, skriv ut i chatten

## Demo-beredskap (för Leopold, inte sessionen)

- Flaggan PÅ om WP41+43 är gröna och du själv testat 5 frågor
- Flaggan AV om något känns skakigt → lager 1 demar ändå
- Mats-frågan kvarstår oavsett: "vill du kunna ställa
  följdfrågor här?" — svaret prioriterar v2
