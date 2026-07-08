// Demons exempeldokument — påhittade namn, påhittade nummer.
// Kaffefakturan finns i två datumvarianter: samma inköp, olika
// affärshändelsedatum → olika momssats (livsmedel 12 % t.o.m. 2026-03-31,
// 6 % fr.o.m. 2026-04-01 enligt prop. 2025/26:55). Det är kvällens
// huvudnummer: regelversionering, bevisad live.

export function kaffefaktura(datum: string, sats: 6 | 12): string {
  const moms = sats === 12 ? "120,00" : "60,00";
  const totalt = sats === 12 ? "1 120,00" : "1 060,00";
  return `FAKTURA
Kafferosteriet Exempel AB
Org.nr 556999-0001

Fakturadatum: ${datum}
Fakturanr: 2026-${sats === 12 ? "0311" : "0708"}

Avser: Kaffebönor, mörkrost 20 kg (livsmedel)

Nettobelopp:        1 000,00 kr
Moms (${sats} %):        ${moms} kr
Att betala:         ${totalt} kr

Betalningsvillkor: 30 dagar
Bankgiro: 999-9999`;
}

export const BYGGFAKTURA = `FAKTURA
Underentreprenad Exempel AB
Org.nr 556999-0002

Fakturadatum: 2026-07-01
Fakturanr: UE-2026-114

Avser: Markarbeten etapp 2, byggtjänst enligt avtal

Nettobelopp:        10 000,00 kr
Moms:                    0,00 kr
Att betala:         10 000,00 kr

Omvänd betalningsskyldighet för byggtjänster gäller.
Köparen redovisar momsen (ML 16 kap. 13 §).
Betalningsvillkor: 30 dagar
Bankgiro: 888-8888`;

export const EXEMPEL = [
  {
    id: "kaffe_mars",
    label: "Kaffebönor — faktura daterad 15 mars 2026 (12 %)",
    tenant: "kund_a",
    text: kaffefaktura("2026-03-15", 12),
  },
  {
    id: "kaffe_juli",
    label: "Kaffebönor — faktura daterad 8 juli 2026 (6 %)",
    tenant: "kund_a",
    text: kaffefaktura("2026-07-08", 6),
  },
  {
    id: "bygg",
    label: "Byggtjänst — omvänd betalningsskyldighet (kund B)",
    tenant: "kund_b",
    text: BYGGFAKTURA,
  },
] as const;
