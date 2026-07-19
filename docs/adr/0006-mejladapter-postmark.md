# ADR-0006: Mejladaptern — generiskt payloadformat, Postmark som leverantör

**Date**: 2026-07-19
**Status**: accepted (genomförd i branchen intag, WP23)
**Deciders**: Leopold (via KICKOFF-INTAG), nattpasset

## Context

Intag S3 (WP23) kräver en mejlkanal in: adress per klient
(`kvitto+<tenant>@inbound.<domän>`) som landar i samma intake-flöde som
app och API (ADR-0002: alla kanaler är dumma kurirer in till samma
port). Dessutom ersätter WP23 underlagsjaktens mailto-länk med riktig
utgående sändning. Kickoffen kräver ett generiskt payloadformat + EN
leverantörsadapter (Postmark ELLER Resend), med kort motivering.

## Decision

Webhooken `/api/intake/mail` tar ett **generiskt inbound-format**
(`InboundMejl`: till[], fran, amne, text, bilagor[]); leverantören
översätts av en ren parserfunktion före allt annat. Leverantören är
**Postmark**, för både inbound och outbound.

Motivering i korthet:

- **En leverantör för båda riktningarna.** WP23 behöver samtidigt
  inbound-parsning och utgående påminnelsemejl. Postmark har båda bakom
  samma servertoken; Resends inbound är nyare och smalare.
- **Mogen inbound-parsning.** Postmarks inbound-webhook är branschens
  referens: ren JSON med `FromFull`/`ToFull`/`Attachments` (base64
  direkt i payloaden — ingen extra hämtningsrunda), bevarad
  plus-adressering, dokumenterad retry-semantik.
- **Adaptern gör valet billigt att ändra.** Endast
  `parsePostmarkInbound` och `PostmarkMejlAdapter` känner leverantören;
  byte till Resend (eller SES) är två funktioner, inte en ombyggnad.

Riktig DNS-/leverantörskoppling (MX för inbound-domänen, webhook-URL
med `INBOUND_MAIL_SECRET`, `POSTMARK_SERVER_TOKEN`) sker vid deploy
(S4) — lokalt testas kedjan med inspelad payload, och utan token loggar
utgående-adaptern spårraden i `utgaende_mejl` i stället för att skicka.

## Alternatives Considered

### Alternative 1: Resend (inbound + outbound)
- **Pros**: Modernt API, snyggt DX, redan populärt för outbound
- **Cons**: Inbound lanserades 2025 och är mindre beprövat; bilagor
  kräver separat hämtning i vissa flöden; färre års driftshistorik för
  just inbound-parsning
- **Why not**: Intagskanalen är produktens ytterdörr — beprövad
  inbound-parsning väger tyngre än DX. Adaptern gör ett framtida byte
  billigt om Resend hinner ikapp.

### Alternative 2: Egen SMTP-mottagning (Haraka/SES-rå)
- **Pros**: Ingen leverantörsberoende parsning
- **Cons**: Drift av MTA, spam/DKIM/SPF-hantering, egna parsers för
  MIME — allt utanför produktens kärna
- **Why not**: Skalar med människotimmar; leverantörens webhook är en
  konfigurationsrad.

## Consequences

### Positive
- Mejl är nu en ren kurir: webhook → generiskt format → samma
  intake-port, källa 'mejl'. Ingen egen väg till tolkning eller ledger.
- Avsändarvakten (registrerade adresser per tenant) + karantän utan
  innehållslagring ger en tydlig säkerhetsgräns för kanalen.
- Utgående spårrader (`utgaende_mejl`, tenant-scopade med RLS) gör
  "vad mejlade vi kunden" läsbart ur kunddatan oavsett transport.

### Negative
- Leverantörslåsning i två funktioner (accepterad, se ovan).
- Karantänen lagrar inte innehållet — ett brev från oregistrerad
  avsändare måste skickas om efter registrering (medvetet: overifierad
  payload ska inte in i systemet).

### Risks
- Webhook-hemligheten är delad nyckel, inte signaturverifiering —
  uppgraderas till Postmarks signatur/basic auth vid deploy-passet.
