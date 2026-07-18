// Textrepresentationer av de åtta verkliga fallen (WP32). Originalen
// (PDF:er) ligger i gitignorerade testdata/underlag/ — dessa texter bär
// samma belopp, mottagare och radinnehåll som fallbeskrivningarna, med
// påhittade namn och nummer. PDF-verifiering mot originalen är ett
// senare pass; golden-facit låses här mot textformen.
//
// OBS fall 6: TESTUNDERLAG-GOLDEN.md finns inte i repot (se
// SESSIONSRAPPORT-innehall.md) — fall 6 är BLOCKERAT och medvetet
// oimplementerat, aldrig gissat.

/** Fall 1 — faktura ställd till ANNAT bolag än tenanten (kund_a =
 *  Café Exempel AB): flag_wrong_tenant, ingen kontering. */
export const FALL_1_FEL_MOTTAGARE = `FAKTURA
Elgrossisten Nord Exempel AB
Org.nr 556999-0101

Fakturadatum: 2026-07-02
Fakturanr: EN-2026-441
Mottagare: Byggmästarna Andersson Exempel AB

Avser: Kabel och installationsmateriel

Nettobelopp:        5 000,00 kr
Moms (25 %):        1 250,00 kr
Att betala:         6 250,00 kr

Betalningsvillkor: 30 dagar
Bankgiro: 777-0101`;

/** Fall 2 — ÄTA-vaksamhet (kund_b, bygg): fakturan åberopar känd order
 *  ORD-2026-77 (känt värde 50 000 kr) men fakturerar 80 000 kr →
 *  ata_avvikelse (needs_review). Omvänd byggmoms gäller. */
export const FALL_2_ATA_AVVIKELSE = `FAKTURA
Underentreprenad Exempel AB
Org.nr 556999-0002

Fakturadatum: 2026-07-10
Fakturanr: UE-2026-198
Mottagare: Bygg Exempel AB
Order: ORD-2026-77

Avser: Markarbeten etapp 2 samt tillkommande ÄTA-arbeten, byggtjänst

Nettobelopp:        80 000,00 kr
Moms:                    0,00 kr
Att betala:         80 000,00 kr

Omvänd betalningsskyldighet för byggtjänster gäller.
Köparen redovisar momsen (ML 16 kap. 13 §).
Betalningsvillkor: 30 dagar
Bankgiro: 888-8888`;

/** Fall 3 — förskott ≠ kostnad (kund_a): förskottsfaktura konteras 1480
 *  Förskott till leverantör, aldrig kostnadskonto. */
export const FALL_3_FORSKOTT = `FAKTURA
Maskinimporten Exempel AB
Org.nr 556999-0303

Fakturadatum: 2026-07-05
Fakturanr: FSK-2026-12
Mottagare: Café Exempel AB

Avser: Förskott 50 % espressomaskin enligt offert 2026-31

Nettobelopp:        10 000,00 kr
Moms (25 %):         2 500,00 kr
Att betala:         12 500,00 kr

Betalningsvillkor: 10 dagar
Bankgiro: 555-0303`;

/** Fall 4 — privat/verksamhetsfrämmande (kund_a): flag_private_expense,
 *  ingen kostnadskontering. */
export const FALL_4_PRIVAT = `KVITTO
Restaurang Guldkanten Exempel AB
Org.nr 556999-0404

Kvittodatum: 2026-07-12
Kvittonr: 8812

Avser: Privat middag, familjefirande — 4 kuvert

Totalt:             2 400,00 kr
Varav moms (12 %):     257,14 kr

Betalt med kort på plats`;

/** Fall 5 — delmatchning (kund_a): underlag↔transaktion är inte 1:1 —
 *  400 kr av kortavräkningen saknar kvitto → missing_receipt med
 *  restbelopp; transaktionen konteras i sin helhet och restbeloppet
 *  jagas i kompletteringskön (WP33). */
export const FALL_5_DELMATCHNING = `FAKTURA
Företagskortet Exempel AB
Org.nr 556999-0505

Fakturadatum: 2026-07-15
Fakturanr: KORT-2026-06
Mottagare: Café Exempel AB

Avser: Kortavräkning juni — 3 transaktioner

Nettobelopp:        1 000,00 kr
Moms (25 %):          250,00 kr
Att betala:         1 250,00 kr
Varav utan kvitto:    400,00 kr

Betalningsvillkor: 20 dagar
Bankgiro: 444-0505`;

/** Fall 7 — elkostnad-anomali (kund_a): 3 800 kr mot historisk median
 *  ~1 216 kr (>2×) → telemetrisignal anomaly_amount; bokförs men
 *  konsulten notifieras. Historiken seedas i testet. */
export const FALL_7_EL_ANOMALI = `FAKTURA
Elhandel Exempel AB
Org.nr 556999-0707

Fakturadatum: 2026-07-16
Fakturanr: EL-2026-07
Mottagare: Café Exempel AB

Avser: Elförbrukning juni — rörligt pris

Nettobelopp:        3 040,00 kr
Moms (25 %):          760,00 kr
Att betala:         3 800,00 kr

Betalningsvillkor: 30 dagar
Bankgiro: 333-0707`;

/** Fall 8 — dubblett (kund_a): samma leverantör + belopp + period körs
 *  två gånger (olika jobb) → andra körningen flaggas dubblett_misstankt.
 *  Ingen Mottagare-rad: verifierar även att mottagarkontrollen inte
 *  falsklarmar när fältet saknas. */
export const FALL_8_DUBBLETT = `FAKTURA
Kafferosteriet Exempel AB
Org.nr 556999-0001

Fakturadatum: 2026-07-08
Fakturanr: 2026-0708

Avser: Kaffebönor, mörkrost 20 kg (livsmedel)

Nettobelopp:        1 000,00 kr
Moms (6 %):            60,00 kr
Att betala:         1 060,00 kr

Betalningsvillkor: 30 dagar
Bankgiro: 999-9999`;
