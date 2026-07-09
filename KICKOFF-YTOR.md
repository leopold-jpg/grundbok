# KICKOFF-YTOR — grundbok S2: auth + de tre ytorna (WP11–WP15)

Förutsättning: PR #1 (modul-plattform) är mergad till main. Skapa ny branch
`ytor` från main. Läs GRUNDBOK-MASTERPLAN.md först — särskilt tabellen över
de tre ytorna; den är facit för vem som ser vad. Läs även DESIGN.md och
design.tokens.css — studio-skinnet ska bära alla tre ytorna, publik sajt
får vara en rikare variant av samma språk.

Samma regler som S1: committa per paket, npm test grönt mellan varje,
pusha när allt är grönt, merga inte. Kärnan (src/lib, src/contracts) ska
INTE ändras i denna session — bara konsumeras. Om något i kärnan verkar
behöva ändras: stanna och fråga.

## WP11 — Auth och roller (grunden för allt annat)

Supabase Auth (lokalt: supabase CLI eller PGlite-kompatibel session-lösning
— välj det som funkar offline, men bakom ett auth-interface så Supabase-bytet
vid deploy är en adapter, samma mönster som Ko-interfacet).

- Tabell `users` (id, email, name) + `memberships` (user_id, tenant_id,
  role: 'konsult') + globala operatörer (role: 'operator' utan tenant).
- decided_by i Decision = user-id, inte fri sträng. Migrera hårdkodade
  konsult@byran.se till en seedad user.
- Middleware: /byra/* kräver konsult-membership (tenant ur sessionen),
  /operator/* kräver operator-roll, publika sajten öppen.
- Seed för dev: en operator (leopold), en byrå (Byrån Exempel AB) med två
  konsulter, kopplad till kund_a och kund_b som byråns klienter.
- OBS datamodell: inför `byra` (byrån) som egen nivå ÖVER tenants om det
  inte finns — en byrå förvaltar flera klientbolag (tenants). Revisions-
  firman med 8 kunder = 1 byrå, 8 tenants. Minsta möjliga ändring:
  tabell byraer + byra_id på tenants + membership pekar på byra.

## WP12 — Publik sajt (/)

Ersätt dagens demo-startsida som publik yta (demoflödet flyttar till
/byra). En sida, sektioner:

1. Hero: "Framtidens redovisning sker här" — en mening om agenter +
   ansvarsprincip. Inga buzzword-listor.
2. Så funkar det: tre steg (släpp in underlaget → agenterna tolkar och
   konterar med lagrum → ni attesterar bara avvikelserna). Gärna en
   stiliserad, avskalad bild av attestkön (statisk komponent med
   exempeldata — INTE riktig data).
3. Moduler: bokföring, rådgivning (live), löner/bokslut/skatt (kommande) —
   ärlig märkning.
4. Kontaktbox: namn, byrå, e-post, fritext → tabell `leads` + tack-vy.
   Ingen mejlutskicksintegration nu.
5. Sidfot: byggd på öppen kärna (länk till GitHub), AI Act-hållning i en
   mening.

Design: studio-skinnet, men våga mer — serif-rubriker, mycket luft,
en (1) accentfärg. Det ska kännas som ett statement, inte en mall.
Mobil först — kontaktboxen ska funka perfekt i telefon.

## WP13 — Byråns arbetsyta (/byra)

Detta är produkten. Inloggad konsult ser SIN byrås värld:

- **Klientväljare**: byråns klientbolag (tenants), sök/växla. Allt nedan
  är scopat till vald klient — eller "alla klienter"-läge för kön.
- **Attestkön** (flyttad från v0-admin, inte ombyggd): förslag med summary,
  konfidens, lagrum, policy-diff. Godkänn/avvisa (motivering krävs) —
  decided_by = inloggad konsult. Attest-språk i UI:t ("att attestera",
  "attesterad"), inte "proposals".
- **Underlag in** (v1: manuellt intag): klistra in text eller ladda upp —
  samma flöde som dagens huvudsida, men inne i arbetsytan och scopat till
  vald klient. (Mejl-intag är S3 — bygg komponenten så en kanal till bara
  är en källa.)
- **Chatten**: rådgivningsmodulen som chatt-UI. Frågor om konton, moms,
  lagrum; svar med lagrumscitat och konfidens. Saldofrågor via ledger:read
  scopat till vald klient. Historik per konsult räcker (ingen delad tråd nu).
- **Beslutslogg**: byråns beslut, filtrerbar per klient. Policy-beslut
  märkta som idag.
- **Klientvy**: per klient — verifikationslista (från dagens huvudsida),
  aktiva agenter (läsvy), gällande policy (läsvy + enkel redigering av
  trösklar med attest-språk: "bokför själv upp till X kr för kända
  motparter").

## WP14 — Operatörskonsolen (/operator)

Bantad och omgjord från v0-admin. Grundarens vy:

- **Bolagslista**: byråer → deras klientbolag → antal agenter, status,
  förslag/vecka (aggregat, ALDRIG innehåll — operatören ser aldrig kvitton).
- **Agentvy per bolag**: lista, provisionera (snyggt flöde: modul → policy-
  mall → namn → nyckel visas en gång med kopiera-knapp och varningstext),
  pausa/återuppta/avsluta, nyckelrotation (skapa ny + avsluta gammal som
  ETT flöde med bekräftelse).
- **Policymallar** (grund för S5): skapa/redigera namngivna mallar
  (t.ex. "Bygg — försiktig", "Restaurang — standard") som väljs vid
  provisionering och kopieras till tenantens policy.
- **Hälsa**: kö-djup, senaste worker-körning, fel senaste dygnet. Enkelt.
- Riv överblivna v0-admin-delar när allt flyttat (kön/loggen bor nu i
  /byra). /admin redirectar till /operator.

## WP15 — Gräns-smoke-tester för ytorna

- Konsult i byrå A kan inte se byrå B:s kö, klienter eller logg (URL-
  manipulation testas explicit).
- Operator ser aggregat men API:erna för förslags-INNEHÅLL nekar
  operator-rollen.
- Oinloggad → /byra och /operator redirectar till login; publika sajten
  och /api/proposals (nyckel-auth) opåverkade.
- decided_by är alltid ett riktigt user-id; attest utan session omöjlig.

## Icke-mål S2

Mejl-intag (S3), deploy (S4), Stripe (S5), nya moduler (S6), notiser,
flerspråk. Lämna TODO-markörer där S3-intaget kopplas in.
