# ADR-0005: Funktionsmallar med branschpaket

**Datum**: 2026-07-18
**Status**: accepted
**Beslutsfattare**: Leopold + Claude

## Context

Ursprungsplanen (ADR-0004) skar mallkatalogen efter bransch:
bokforing-bygg, bokforing-restaurang, bokforing-konsult, lon.
Analys av verkligt testunderlag (TESTUNDERLAG-GOLDEN.md) visade att
kärnkompetensen — mottagarkontroll, förskott, omvänd moms, kvitto-
matchning, dubblettdetektering — är funktionell och branschoberoende.
Branschmallar hade blivit ~80 % kopior av varandra, där en förbättring
måste dupliceras fyra gånger.

## Decision

Mallar är funktionsroller: `bokforing`, `lon`, `skatt-compliance`,
`leverantorsreskontra`. Branschspecifika regler (omvänd byggmoms, ROT,
kassarapporter m.fl.) är fristående branschpaket som aktiveras via
tenant-kontexten. En agent = funktionsmall + tenantens branschpaket +
tenantens historik. Skatterollen avgränsas till compliance
(deklarationsflöden, periodkontroller) — ingen rådgivning i release ett.

## Alternatives Considered

### Alternativ 1: Branschmallar (ursprungsplanen)
- **Pros**: Intuitivt säljbart ("byggagent"), all kunskap på ett ställe
- **Cons**: Massiv duplicering av funktionslogik; kvittomatchnings-
  förbättring måste göras i varje mall; katalogen exploderar
  (funktioner × branscher)
- **Why not**: Testunderlaget visade att <20 % av kompetensen är
  branschspecifik. Fel skärning av domänen.

### Alternativ 2: En enda supermall med all logik
- **Pros**: Noll duplicering
- **Cons**: Oöverskådlig prompt, omöjlig att golden-testa per roll,
  policy kan inte skilja bokföring från lön
- **Why not**: Roller behöver olika autonomipolicyer och olika
  granskningsflöden — lön är känsligare än leverantörsfakturor.

### Alternativ 3: Funktionsmallar + branschpaket (valt)
- **Pros**: Funktionslogik skrivs en gång; branschregler små, testbara
  paket; katalogen växer additivt (ny bransch = ett paket, inte fyra
  mallar); säljbarheten kvar ("bokföringsagent för bygg" = mall+paket)
- **Cons**: Två begrepp i stället för ett; kombinationstester krävs
  (mall × paket)

## Consequences

### Positive
- En förbättring i funktionsmallen når alla branscher vid en deploy
- Branschpaket kan golden-testas isolerat (ROT-fallet testar paketet,
  kvittomatchning testar mallen)
- Ny bransch onboardas utan ny mall — bara ett regelpaket
- Arbetsytornas trestegflöde förenklas: mallvalet blir kort (fyra
  roller), branschen härleds från tenanten i stället för att väljas

### Negative
- MallDefinition får en dimension till (branschpaket?: BranschPaketId[])
- Kombinationsmatrisen mall × paket måste hållas testad — börja med
  de kombinationer som har verkliga tenants, inte alla teoretiska

### Risks
- Branschpaket sväller till skuggmallar → regel: paket innehåller
  ENDAST regler/konteringar som är meningslösa utanför branschen;
  allt annat hör hemma i funktionsmallen
- Otydligt var en regel bor → tumregel dokumenteras i registrets
  README: "gäller regeln minst två branscher bor den i mallen"

## Ersätter delvis

ADR-0004:s mallista (bygg/restaurang/konsult/lon) ersätts av
funktionsroller. ADR-0004:s kärnbeslut — fast versionerad katalog,
ingen fritext per agent, telemetri via vy — gäller oförändrat.
