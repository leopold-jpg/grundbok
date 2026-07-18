# KICKOFF-INTAG — grundbok S3: intag + kundappen (WP20–WP25)

Förutsättning: PR #3 (design) mergad. Branch `intag` från main.
Läs docs/GRUNDBOK-MASTERPLAN.md, docs/adr/ och (om den finns)
docs/design-system.md först. Samma regler som alltid: committa per
paket, npm test grönt mellan varje, kärnan ändras inte (db-tillägg
enligt WP11-undantaget ok), upphovsman Leopold Seifert, hitta aldrig
på uppgifter, pusha och öppna PR, merga inte.

Bärande princip (ADR-0002): ALLA kanaler är dumma kurirer in till
samma port. Ingen kanal får egen väg till tolkning eller ledger.

## WP20 — klientanvändaren (identiteten)

- Roll `klient` i memberships: pekar på EN tenant (klientbolaget),
  inbjuden av byråns konsult från klientvyn i /byra (invite-länk med
  engångstoken → kunden sätter lösenord/e-post).
- Scopes: lämna underlag + läsa egen status/egna verifikat. ALDRIG
  andra tenants, aldrig byråvyer, aldrig policys.
- Smoke: klient i bolag A kan inte nå bolag B eller /byra; utgången
  invite-token är död.

## WP21 — intake-porten

- `POST /api/intake`: auth via klientsession ELLER tenant-scopad
  agentnyckel. Tar foto/PDF/text → presignerad uppladdning till
  storage → rad i `underlag` (tenant, källa: app/mejl/api, status
  'mottaget') → jobb i kön → befintlig worker → buildProposal →
  attestkö. Status uppdateras: mottaget → tolkat → bokfort
  (härleds ur proposal/decision, ingen egen statemaskin).
- Dokument-tenant-vakten från Bugbot-fixen återanvänds.
- Idempotens: klient-uppladdning får content-hash — samma fil två
  gånger ger en (1) underlagsrad med notis, aldrig dubbla förslag.

## WP22 — kundappen (PWA, /app)

Mobil först, installerbar (manifest + ikoner ur docs/brand/), tre
ytor efter Leopolds spec — begriplig på fem sekunder:

1. **Läget** (hem): inlämnat denna månad, senast bokfört, antal som
   väntar. ENDAST obestridliga siffror i v1 — resultat/saldon är en
   per-klient-flagga byrån slår på senare (bygg flaggan, default av).
2. **Skicka in**: stor kameraknapp → fota/välj → kvittens direkt.
   Max två tryck. Historiklista där varje underlag visar sin resa
   som stämplar (Mottaget → Tolkat → Bokfört) och är sökbar på
   motpart/månad.
3. **Fråga** (kundassistenten): chatt scopad till egna underlag och
   verifikat ("vad var fakturan från X i mars?", "hur mycket moms?").
   ALDRIG rådgivning — fallback: "vill du att jag skickar frågan
   till din revisor?" → ärende i byråns kö med underlaget länkat.
   Modul `kundassistent` enligt masterplanen (radgivnings-maskineriet,
   snävare scopes).

Design: designsystemet/ljusa papperspaletten, D1-märket som app-ikon
(appicon-paper-512), stämpel-estetik på statusar. Status via polling
i v1 (Realtime är S4+).

## WP23 — mejl-adaptern

- Inbound-webhook-endpoint (`/api/intake/mail`) byggd mot ett
  generiskt payloadformat + adapter för en leverantör (välj
  Postmark ELLER Resend inbound — motivera kort i ADR-anteckning;
  riktig DNS/leverantörskoppling sker vid deploy, lokalt testas med
  inspelad payload).
- Adress per klient (t.ex. kvitto+<tenantslug>@inbound.<domän>) →
  slås upp till tenant → samma intake-flöde, källa 'mejl'.
- Avsändarvalidering: endast registrerade avsändaradresser per
  tenant (klienten anger sina i appen), övriga → karantänlista i
  byråns klientvy.

## WP24 — byråsidan av kanalen

- /byra klientvy: bjud in klientanvändare, se klientens kanaler
  (app aktiverad, mejladress, registrerade avsändare), karantänen,
  och kundassistent-ärenden i attestköns flik "Frågor".
- Operatörskonsolen: aggregat (underlag/vecka per kanal) — aldrig
  innehåll.

## WP25 — gräns-smoke för hela kanalen

- Mejl från oregistrerad avsändare → karantän, aldrig förslag.
- Klient ser bara egen historik; annan tenants underlag-id → 404.
- Dubbel uppladdning → en rad. Intake utan giltig auth → 401.
- Kundassistenten vägrar rådgivningsfråga och erbjuder eskalering;
  eskalering syns i byråns kö.

## Icke-mål S3

Telegram-bryggan (medvetet: appen ERSÄTTER Telegram — bryggan byggs
bara om en pilotkund kräver den; designa inget för den nu utöver att
källfältet rymmer 'telegram'), push-notiser, Realtime, resultat-
siffror i appen, App Store-paketering (PWA räcker), fler mejl-
leverantörer.
