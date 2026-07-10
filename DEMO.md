# DEMO — Mats-demon: de tre ytorna

Körschema för masterplanens demo (docs/GRUNDBOK-MASTERPLAN.md): publik sajt →
byråns arbetsyta → policyändring → operatörskonsolen. Arkitekturen står i
[ULTRAPLAN.md](./ULTRAPLAN.md) och masterplanen — det här är bara knapparna.

**Dev-inloggningar** (lösenord `grundbok-dev` för alla):
konsult `konsult.ett@byran-exempel.se` · operatör `leopold@otiva.se`

---

## 1. Pre-flight (10 minuter före)

- [ ] `npm install` (om repot är färskt klonat)
- [ ] `cp .env.example .env.local` och klistra in `ANTHROPIC_API_KEY`
      (nyckeln läses enbart från env — aldrig i argv eller committad fil)
- [ ] **Färsk databas:** stoppa ev. server → `rm -rf .data` → `npm run dev`
      → öppna **http://localhost:3456**
- [ ] Verifiera hela kedjan i ett svep mot servern:
      `python3 scripts/e2e.py` → **51/51 kontroller gröna**. Raden
      `motor: anthropic` bekräftar att live-AI-vägen fungerar.
- [ ] **Nollställ efter e2e:n** (den bokför testdata): stoppa servern →
      `rm -rf .data` → `npm run dev`
- [ ] Håll en andra terminal redo i repo-roten (beat 6 kör curl)

---

## 2. Demoscript

### Beat 1 — Publika sajten (30 sek)

Öppna **http://localhost:3456**. Skrolla lugnt: hero → så-funkar-det med den
statiska attestkön → modulerna (live/kommande, ärligt märkt) → kontaktboxen.

> **Säg:** "Det här är allt en blivande kund ser — visionen och en väg in.
> Ingen riktig data på den publika ytan, någonsin."

### Beat 2 — Logga in som byrå (3 min)

Klicka **Logga in** (uppe till höger) → `konsult.ett@byran-exempel.se` /
`grundbok-dev` → du landar i **byråns arbetsyta**.

1. Välj **Café Exempel AB (cafe)** i klientväljaren uppe till höger.
2. Fliken **Underlag in** → klicka exempelknappen
   **"Kaffebönor — faktura daterad 8 juli 2026 (6 %)"** → **Tolka underlaget**.
3. Steg 2 visar tolkningen (motpart, netto 1 000,00 kr, livsmedel);
   steg 3 visar förslaget: **6 %** moms, lagrum ML (2023:200) 9 kap.,
   raderna `4010 D 1000,00 / 2641 D 60,00 / 2440 K 1060,00`, hash- och
   konfidens-chips.
4. **Momsväxlingen (huvudnumret — ta tid på dig):** klicka knappen
   **"15 mars 2026"**. Förslaget räknas om live: **12 %**
   (`2641 D 120,00 / 2440 K 1120,00`) + en flagga — underlaget anger 6 %
   men regelverket ger 12 % för det datumet. Klicka tillbaka
   **"8 juli 2026"**.

   > **Säg:** "Momssatsen är versionerad, datumavgränsad data — byter jag
   > affärshändelsedatum byter regeln, och när underlag och regelverk säger
   > olika saker flaggas det i stället för att ersättas tyst."

5. Klicka den stora knappen **"Attestera och bokför"** → bekräftelsen visar
   **verifikation 1** med Fortnox-referens `FTX-MOCK-2026-0001`.

   > **Säg:** "Attesten binds till förslagets hash och konsultens inloggade
   > identitet — decided_by är ett verifierat user-id, aldrig en sträng."

6. Fliken **Att attestera**: tom ("Inget att attestera just nu"). Fliken
   **Beslutslogg**: beslutet står som **attesterad · Konsult Ett Exempel**.

### Beat 3 — Policyändringen: "så krymper attesthögen" (1 min)

1. Fliken **Klient** (Café Exempel AB vald) → sektionen **Policy**.
2. Under **Bokföring**: bocka i **"Bokför själv upp till"**, sätt **2000** kr,
   låt **"endast kända motparter"** vara ibockad, sätt konfidensen till
   **0,5** → **Spara** ("sparad — attestkön räknas om mot nya policyn").
3. Tillbaka till **Underlag in** → samma kaffeknapp → **Tolka underlaget**.
   Steg 3 visar nu **"inom er policy — bokförd som policybeslut"** —
   verifikation 2, ingen attest behövdes.
4. **Beslutslogg**: raden är märkt **policybeslut**, inte ett konsultnamn.

> **Säg:** "Kafferosteriet blev en känd motpart i och med den första attesten.
> Byrån vrider på ratten — rutinhändelser inom policyn bokför sig själva,
> loggade som policybeslut, och attesthögen krymper. Rättelser kräver alltid
> människa, oavsett policy — det är en hård regel i motorn."

### Beat 4 — Byrå-gränsen (30 sek)

Byt klient till **Bygg Exempel AB** → fliken **Klient**: huvudboken är tom.
Valfritt: kör byggfakturan i **Underlag in** — omvänd betalningsskyldighet,
`4425 / 2440 / 2614 / 2647`, deklarationsrutor 24/30/48, lagrum ML 16 kap. 13 §.

> **Säg:** "Isoleringen är RLS-policyer i databasen, inte appfilter. Och en
> konsult ser bara sin byrås klienter — begär hon någon annans via URL:en
> blir det 403."

### Beat 5 — Operatörskonsolen (2 min)

**Logga ut** → logga in som `leopold@otiva.se` → du landar i **operatörskonsolen**.

1. **Bolag**-tabellen: byrå → klientbolag → antal agenter, förslag/beslut
   senaste 7 dygnen.

   > **Säg:** "Det här är hela operatörens värld — aggregat. Inga kvitton,
   > inga belopp, inga motparter. Attest bor hos byrån, drift hos operatören.
   > Grundaren godkänner aldrig ett kvitto."

2. Klicka raden **Café Exempel AB** → **Agenter**-sektionen aktiveras.
3. Provisionera: välj **mall: Restaurang — standard**, skriv namnet
   `kvittoagent-cafe` → **Provisionera agent**. Nyckeln (`gk_…`) visas EN
   gång med kopiera-knapp — kopiera den.

   > **Säg:** "En kund är en config — provisionera tar en sekund, och mallens
   > policy kopieras till bolaget. Nyckeln kan föreslå, aldrig bokföra."

### Beat 6 — Pausa → porten stängs (1 min)

I den andra terminalen (klistra in nyckeln från beat 5):

```bash
NYCKEL="gk_…"   # från provisioneringen
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3456/api/proposals \
  -H "authorization: Bearer $NYCKEL" -H "content-type: application/json" -d '{}'
```

→ **422** (nyckeln är inne; tomt förslag stoppas av schemavalideringen).

Klicka **Pausa** på agenten i konsolen → kör samma curl igen → **403**.
Klicka **Återuppta** → curl igen → **422**.

> **Säg:** "En agent är en rad i databasen, inte en maskin. Pausa är en
> statusändring och porten svarar 403 på en känd men pausad nyckel —
> 401 är för okända. Rotation är samma sak: ny nyckel, gamla avslutas,
> ett flöde."

*Extra om tid finns:* **Rotera nyckel** på agenten (bekräfta) → ny nyckel
visas en gång, gamla ger 403. Eller visa **Chatt**-fliken som konsult:
"Vilken momssats gäller för livsmedel?" → svar med lagrum och konfidens.

---

## 3. Om något strular

**API:t dör mitt i demon.**
Ingen åtgärd krävs — tolkningen degraderar automatiskt till den
deterministiska fallbacken (samma schema); steg 2 visar
"deterministisk fallback" i stället för modellnamnet.
> **Säg det som en poäng:** "Flödet degraderar deterministiskt i stället
> för att krascha, och läget redovisas alltid öppet."

**Servern hänger.**
`Ctrl-C` → `npm run dev` igen (port 3456). Upptagen port:
`pkill -f "next dev"` och starta om.

**Nollställa demon.**
Stoppa servern → `rm -rf .data` → `npm run dev`. Färsk databas med seedade
konton och startmallar.

**Köra helt utan nyckel.**
Sätt `GRUNDBOK_FORCE_FALLBACK=1` (eller ta bort nyckeln ur `.env.local`) —
hela demon fungerar i mock-läge. `npm run test:fallback` verifierar
fallback-vägen utan nät.
