// Mini-sparkline (WP27/WP28) — verkliga antal ur systemet, ritade
// deterministiskt: ingen animation, ingen slump, skalan är seriens
// eget max. aria-label bär de riktiga talen (rullande siffror läggs
// aldrig i live-regioner — kanon §6).

export function Sparkline({
  varden,
  etikett,
  bredd = 72,
  hojd = 20,
}: {
  varden: number[];
  etikett: string;
  bredd?: number;
  hojd?: number;
}) {
  if (varden.length === 0) return null;
  const max = Math.max(...varden, 1);
  const steg = varden.length > 1 ? bredd / (varden.length - 1) : 0;
  const punkter = varden
    .map((v, i) => `${(i * steg).toFixed(1)},${(hojd - 2 - (v / max) * (hojd - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      className="sparkline"
      width={bredd}
      height={hojd}
      viewBox={`0 0 ${bredd} ${hojd}`}
      role="img"
      aria-label={etikett}
    >
      <polyline points={punkter} />
    </svg>
  );
}
