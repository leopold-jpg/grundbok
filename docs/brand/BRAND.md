# Märket — verifikatet (D1)

Pixelkvitto 3×5 på strikt rutnät (cell 21, mellanrum 3, pitch 24).
Rustpixeln är beloppsraden — den får blinka lugnt i digitala ytor.
Perforeringen i botten är det som gör märket läsbart som kvitto: ta
aldrig bort den.

## Filer
- mark-ink / mark-paper: standard, med rust-accent (ljus resp. mörk yta)
- mark-mono-*: enfärgat när accent inte funkar (stämplar, gravyr, fax)
- mark-on-ink / mark-on-paper: med inbakad platta
- favicon-16/32/180/512.png, appicon-paper-512.png

## Regler
- Frizon runt märket: minst en pixelcell (24 enheter) åt alla håll.
- Skala aldrig fritt — endast hela multiplar av rutnätet i pixel-
  kritiska storlekar.
- Rust används ENDAST på beloppsraden. Aldrig fler färgade pixlar.
- Märket är namnoberoende: ordmärke sätts bredvid (vänster om eller
  under), aldrig inuti.

## Blå variant (riktningsbytet 2026-07-11)

Sajten kör vit/blå SaaS-system: mark-blue.svg / mark-blue-paper.svg
har beloppsraden i klarblått (#2563EB) i stället för rust. Samma
regler gäller — accentfärg ENDAST på beloppsraden, perforeringen
kvar. Rust-varianterna behålls tills namn-/märkesbeslutet är taget.
