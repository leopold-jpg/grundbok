"use client";

/**
 * ArkitekturFigur — ritad arkitekturvisual för sektionen "Förtroende är arkitektur".
 *
 * Ersätter de fyra textkorten med EN figur: UNDERLAG → FÖRSLAG → HASH →
 * förgrening (ATTEST — behörig människa | POLICY — era regler) → HUVUDBOK
 * (append-only). De fyra förtroendepoängerna sitter som korta etiketter i
 * figuren: obeslutbarheten vid hashen, isoleringsramen runt flödet med
 * hörnetiketten "radnivå-isolering — er värld", den brutna pilen från
 * FÖRSLAG mot den överstrukna rutan "modellträning" (pilen bryts exakt där
 * den skulle lämna er värld), och "mänsklig kontroll som mekanism
 * (AI-förordningen)" vid förgreningen.
 *
 * Props-kontrakt:
 *   spelar = mounted && !prefers-reduced-motion (beräknas av föräldern).
 *   Servern renderar alltid spelar={false} → figuren är statisk och fullt
 *   synlig. DOM:en är identisk i båda lägena — endast animationsprops
 *   skiljer. När spelar är true ritas förbindelselinjerna in med pathLength
 *   och noderna tonar fram (staggered via delay), en gång när figuren
 *   scrollas in (viewport once). Därefter vandrar en kort ljuspuls i --bla
 *   längs huvudflödet (animated beam: extra path med samma d ovanpå varje
 *   flödeslinje, kort dash som glider via strokeDashoffset), loopande lugnt
 *   och staggad så pulsen läses som ETT flöde: underlag→förslag→hash pulsar
 *   först, sedan förgreningen, sedan in i huvudboken. Vid spelar=false
 *   renderas beam-pathsen med opacity 0 — samma DOM.
 *
 * Två varianter, båda renderas alltid; integratören växlar synlighet med
 * CSS i publik.css:
 *   .ark-bred — horisontellt flöde, viewBox 920×360, visas ≥760px
 *   .ark-smal — vertikalt flöde,   viewBox 360×720, visas under 760px
 *
 * Färger och typografi enbart via CSS-variabler (publik.css): --ink*,
 * --yta, --yta-is, --kort, --linje-stark, --bla (accenten: attest-noden och
 * ljuspulsen), --font-sans/--font-mono. Mono används ENDAST för sifferdata
 * (hashen) — alla etiketter sätts i sans som smallcaps.
 */

import { motion } from "framer-motion";

type Props = { spelar: boolean };

const LUGN = [0.22, 1, 0.36, 1] as const;

const ARIA =
  "Arkitekturen: underlag blir förslag som hashas; beslut fattas av behörig människa eller er policy; allt landar i en append-only huvudbok. En ändrad rad gör förslaget obeslutbart, varje kund är radnivå-isolerad och ingen data tränar modeller.";

/* Färgtokens — alltid via CSS-variabler, aldrig hex i komponenten. */
const INK = "var(--ink)";
const INK_MJUK = "var(--ink-mjuk)";
const INK_SVAG = "var(--ink-svag)";
const BLA = "var(--bla)"; /* accenten: attest-noden + ljuspulsen */
const YTA = "var(--yta)";
const KORT = "var(--kort)";
const YTA_IS = "var(--yta-is)";
const LINJE_STARK = "var(--linje-stark)";
const SANS = "var(--font-sans)";
const MONO = "var(--font-mono)";

/* ————— Animationsprops ————— *
 * spelar=false ger { initial: false } → statisk, fullt synlig rendering
 * (serverns läge). Keyframe-listorna ([0, 1] osv.) gör att animationen
 * spelar från start även när spelar slår om från false till true efter
 * mount (initial läses bara vid mount). */

/** Nod/etikett: tonar in och glider upp 6px. */
function tona(spelar: boolean, delay: number) {
  if (!spelar) return { initial: false };
  return {
    initial: { opacity: 0, y: 6 },
    whileInView: { opacity: [0, 1], y: [6, 0] },
    viewport: { once: true },
    transition: { duration: 0.55, ease: LUGN, delay },
  };
}

/** Ren opacitetstoning (pilspetsar, brytstreck, ram-etikett). */
function fram(spelar: boolean, delay: number) {
  if (!spelar) return { initial: false };
  return {
    initial: { opacity: 0 },
    whileInView: { opacity: [0, 1] },
    viewport: { once: true },
    transition: { duration: 0.4, ease: LUGN, delay },
  };
}

/** Förbindelselinje: ritas in med pathLength 0 → 1. */
function rita(spelar: boolean, delay: number, tid: number) {
  if (!spelar) return { initial: false };
  return {
    initial: { pathLength: 0 },
    whileInView: { pathLength: [0, 1] },
    viewport: { once: true },
    transition: { duration: tid, ease: LUGN, delay },
  };
}

/* ————— Ljuspulsen (animated beam) ————— *
 * En kort dash (PULS_DASH enheter) glider längs flödeslinjen genom att
 * strokeDashoffset animeras från PULS_DASH (pulsen helt före linjestart)
 * till -langd (pulsen helt förbi linjeslutet) — den glider alltså in i ena
 * änden och ut i den andra, aldrig ett hårt hopp. Alla pulser delar samma
 * cykellängd (tid + repeatDelay = PULS_PERIOD) så staggningen ligger fast
 * varv efter varv och läses som ETT flöde genom systemet. */

const PULS_DASH = 12;
const PULS_PERIOD = 5.4; /* sekunder per varv, gemensam för alla segment */
const PULS_INTRO = 2.6; /* pulsen väntar tills draw-in-animationen är klar */

type PulsSpec = { d: string; langd: number; steg: number; tid: number };

function Puls({ d, langd, spelar, steg, tid }: PulsSpec & { spelar: boolean }) {
  const rorelse = spelar
    ? {
        initial: { strokeDashoffset: PULS_DASH },
        whileInView: { strokeDashoffset: [PULS_DASH, -langd] },
        viewport: { once: true },
        transition: {
          duration: tid,
          delay: PULS_INTRO + steg,
          ease: "easeInOut" as const,
          repeat: Infinity,
          repeatDelay: PULS_PERIOD - tid,
        },
      }
    : { initial: false as const };
  return (
    <motion.path
      d={d}
      fill="none"
      stroke={BLA}
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray={`${PULS_DASH} ${langd}`}
      strokeDashoffset={PULS_DASH}
      opacity={spelar ? 1 : 0}
      {...rorelse}
    />
  );
}

/* ————— Små byggstenar ————— */

function Ruta({
  x,
  y,
  b,
  h,
  rund = 7,
  kant = LINJE_STARK,
  tjocklek = 1,
  fyllnad = KORT,
}: {
  x: number;
  y: number;
  b: number;
  h: number;
  rund?: number;
  kant?: string;
  tjocklek?: number;
  fyllnad?: string;
}) {
  return (
    <rect x={x} y={y} width={b} height={h} rx={rund} fill={fyllnad} stroke={kant} strokeWidth={tjocklek} />
  );
}

function Rubrik({ x, y, text, farg = INK }: { x: number; y: number; text: string; farg?: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontFamily={SANS}
      fontWeight={600}
      fontSize={13}
      letterSpacing="0.06em"
      fill={farg}
    >
      {text}
    </text>
  );
}

/** Etikett — sans smallcaps (uppercase + spärrning). Aldrig mono. */
function Sma({
  x,
  y,
  text,
  farg = INK_SVAG,
  storlek = 9,
  anchor = "middle",
  spar = "0.06em",
}: {
  x: number;
  y: number;
  text: string;
  farg?: string;
  storlek?: number;
  anchor?: "start" | "middle" | "end";
  spar?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontFamily={SANS}
      fontWeight={600}
      fontSize={storlek}
      letterSpacing={spar}
      fill={farg}
      style={{ textTransform: "uppercase" }}
    >
      {text}
    </text>
  );
}

/** Sifferdata (hashen) — det enda mono-innehållet i figuren. */
function Data({ x, y, text, farg = INK, storlek = 11 }: { x: number; y: number; text: string; farg?: string; storlek?: number }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontFamily={MONO} fontSize={storlek} fill={farg}>
      {text}
    </text>
  );
}

/** Diskret pilspets (liten öppen vinkel) som tonar fram när linjen nått den. */
function Spets({
  x,
  y,
  mot,
  spelar,
  delay,
}: {
  x: number;
  y: number;
  mot: "hoger" | "upp" | "ner";
  spelar: boolean;
  delay: number;
}) {
  const d =
    mot === "hoger"
      ? `M ${x - 7} ${y - 4} L ${x} ${y} L ${x - 7} ${y + 4}`
      : mot === "ner"
        ? `M ${x - 4} ${y - 7} L ${x} ${y} L ${x + 4} ${y - 7}`
        : `M ${x - 4} ${y + 7} L ${x} ${y} L ${x + 4} ${y + 7}`;
  return (
    <motion.path
      d={d}
      fill="none"
      stroke={INK_MJUK}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...fram(spelar, delay)}
    />
  );
}

/** Förbindelselinje som ritas in. */
function Linje({ d, spelar, delay, tid = 0.9 }: { d: string; spelar: boolean; delay: number; tid?: number }) {
  return <motion.path d={d} fill="none" stroke={INK_MJUK} strokeWidth={1.25} {...rita(spelar, delay, tid)} />;
}

const CHIPS = ["modell", "konfidens", "lagrum"] as const;
const HASHTEXT = "#9f2c…";

/* ————— Huvudflödets förbindelselinjer ————— *
 * Delade konstanter så att baslinje (Linje) och ljuspuls (Puls) garanterat
 * har exakt samma d. langd = exakt polylinjelängd (alla segment är
 * axelparallella). */

const FLODE_BRED = {
  underlagForslag: "M136 212 H167",
  forslagHash: "M326 212 H357",
  hashStam: "M476 212 H508",
  stamAttest: "M508 212 V150 H550",
  stamPolicy: "M508 212 V274 H550",
  attestHuvudbok: "M710 150 H738 V190 H757",
  policyHuvudbok: "M710 274 H738 V246 H757",
} as const;

/* Koreografi: underlag→förslag→hash i tur och ordning, sedan förgreningen
 * (båda grenarna samtidigt — själva splitten), sedan in i huvudboken. */
const PULS_BRED: PulsSpec[] = [
  { d: FLODE_BRED.underlagForslag, langd: 31, steg: 0, tid: 0.55 },
  { d: FLODE_BRED.forslagHash, langd: 31, steg: 0.65, tid: 0.55 },
  { d: FLODE_BRED.hashStam, langd: 32, steg: 1.3, tid: 0.45 },
  { d: FLODE_BRED.stamAttest, langd: 104, steg: 1.75, tid: 0.9 },
  { d: FLODE_BRED.stamPolicy, langd: 104, steg: 1.75, tid: 0.9 },
  { d: FLODE_BRED.attestHuvudbok, langd: 87, steg: 2.65, tid: 0.8 },
  { d: FLODE_BRED.policyHuvudbok, langd: 75, steg: 2.65, tid: 0.8 },
];

const FLODE_SMAL = {
  underlagForslag: "M132 120 V143",
  forslagHash: "M132 286 V309",
  hashStam: "M132 388 V440",
  stamAttest: "M132 440 H74 V453",
  stamPolicy: "M132 440 H190 V453",
  attestHuvudbok: "M74 530 V553",
  policyHuvudbok: "M190 530 V553",
} as const;

const PULS_SMAL: PulsSpec[] = [
  { d: FLODE_SMAL.underlagForslag, langd: 23, steg: 0, tid: 0.45 },
  { d: FLODE_SMAL.forslagHash, langd: 23, steg: 0.65, tid: 0.45 },
  { d: FLODE_SMAL.hashStam, langd: 52, steg: 1.3, tid: 0.5 },
  { d: FLODE_SMAL.stamAttest, langd: 71, steg: 1.8, tid: 0.75 },
  { d: FLODE_SMAL.stamPolicy, langd: 71, steg: 1.8, tid: 0.75 },
  { d: FLODE_SMAL.attestHuvudbok, langd: 23, steg: 2.55, tid: 0.45 },
  { d: FLODE_SMAL.policyHuvudbok, langd: 23, steg: 2.55, tid: 0.45 },
];

/* ————— Bred variant: horisontellt flöde, 920×360 ————— */

function Bred({ spelar }: Props) {
  return (
    <svg
      className="ark-bred"
      viewBox="0 0 920 360"
      role="img"
      aria-label={ARIA}
      style={{ width: "100%", height: "auto" }}
    >
      <g aria-hidden="true">
        {/* Punkt 2: isoleringsramen runt hela flödet — modellträning ligger
            medvetet UTANFÖR ramen (er värld). */}
        <motion.path
          d="M20 86 H900 V340 H20 Z"
          fill="none"
          stroke={LINJE_STARK}
          strokeWidth={1}
          {...rita(spelar, 0, 1.6)}
        />
        <motion.g {...fram(spelar, 0.3)}>
          <rect x={30} y={79} width={194} height={14} fill={YTA} />
          <Sma x={36} y={89.5} anchor="start" spar="0.08em" text="RADNIVÅ-ISOLERING — ER VÄRLD" />
        </motion.g>

        {/* UNDERLAG — dokumentruta */}
        <motion.g {...tona(spelar, 0.1)}>
          <Ruta x={36} y={162} b={100} h={100} />
          <Rubrik x={86} y={186} text="UNDERLAG" />
          <path d="M52 204 H120 M52 218 H120 M52 232 H120 M52 246 H104" fill="none" stroke={LINJE_STARK} strokeWidth={1} />
        </motion.g>

        <Linje d={FLODE_BRED.underlagForslag} spelar={spelar} delay={0.25} />
        <Spets x={174} y={212} mot="hoger" spelar={spelar} delay={1.15} />

        {/* FÖRSLAG — tre chips */}
        <motion.g {...tona(spelar, 0.45)}>
          <Ruta x={176} y={152} b={150} h={120} />
          <Rubrik x={251} y={174} text="FÖRSLAG" />
          {CHIPS.map((chip, i) => (
            <g key={chip}>
              <rect x={197} y={188 + i * 28} width={108} height={22} rx={4} fill={YTA_IS} />
              <Sma x={251} y={202.5 + i * 28} text={chip} farg={INK_MJUK} storlek={10} />
            </g>
          ))}
        </motion.g>

        {/* Punkt 3: bruten pil mot modellträning — bryts exakt i ramlinjen. */}
        <Linje d="M251 152 L251 92" spelar={spelar} delay={0.65} tid={0.6} />
        <Linje d="M251 80 L251 64" spelar={spelar} delay={0.85} tid={0.3} />
        <motion.path
          d="M245 92 L257 80"
          fill="none"
          stroke={INK_MJUK}
          strokeWidth={1.25}
          strokeLinecap="round"
          {...fram(spelar, 1.05)}
        />
        <Spets x={251} y={57} mot="upp" spelar={spelar} delay={1.15} />
        <motion.g {...tona(spelar, 0.95)}>
          <Ruta x={196} y={20} b={110} h={34} rund={6} fyllnad={YTA} />
          <Sma x={251} y={41} text="modellträning" storlek={9.5} />
          <path d="M202 50 L300 24" fill="none" stroke={INK_MJUK} strokeWidth={1.25} />
          <Sma x={262} y={108} anchor="start" text="tränar aldrig på er data" />
        </motion.g>

        <Linje d={FLODE_BRED.forslagHash} spelar={spelar} delay={0.55} />
        <Spets x={364} y={212} mot="hoger" spelar={spelar} delay={1.45} />

        {/* HASH + punkt 1 */}
        <motion.g {...tona(spelar, 0.75)}>
          <Ruta x={366} y={187} b={110} h={50} />
          <Rubrik x={421} y={206} text="HASH" />
          <Data x={421} y={226} text={HASHTEXT} />
        </motion.g>
        <motion.g {...tona(spelar, 0.95)}>
          <Sma x={421} y={254} text="en ändrad rad → obeslutbart" />
        </motion.g>

        {/* Förgreningen */}
        <Linje d={FLODE_BRED.hashStam} spelar={spelar} delay={0.9} tid={0.4} />
        <Linje d={FLODE_BRED.stamAttest} spelar={spelar} delay={1.05} tid={0.8} />
        <Spets x={557} y={150} mot="hoger" spelar={spelar} delay={1.85} />
        <Linje d={FLODE_BRED.stamPolicy} spelar={spelar} delay={1.15} tid={0.8} />
        <Spets x={557} y={274} mot="hoger" spelar={spelar} delay={1.95} />

        {/* ATTEST — accentnoden (den enda blå ytan) */}
        <motion.g {...tona(spelar, 1.3)}>
          <Ruta x={560} y={120} b={150} h={60} kant={BLA} tjocklek={1.5} />
          <Rubrik x={635} y={146} text="ATTEST" farg={BLA} />
          <Sma x={635} y={165} text="behörig människa" farg={BLA} />
        </motion.g>

        {/* Punkt 4 — i förgreningens mitt */}
        <motion.g {...tona(spelar, 1.6)}>
          <Sma x={635} y={207} text="mänsklig kontroll som mekanism" />
          <Sma x={635} y={220} text="(AI-förordningen)" />
        </motion.g>

        {/* POLICY */}
        <motion.g {...tona(spelar, 1.4)}>
          <Ruta x={560} y={244} b={150} h={60} kant={INK} tjocklek={1.25} />
          <Rubrik x={635} y={270} text="POLICY" />
          <Sma x={635} y={289} text="era regler" farg={INK_MJUK} />
        </motion.g>

        <Linje d={FLODE_BRED.attestHuvudbok} spelar={spelar} delay={1.5} tid={0.8} />
        <Spets x={764} y={190} mot="hoger" spelar={spelar} delay={2.3} />
        <Linje d={FLODE_BRED.policyHuvudbok} spelar={spelar} delay={1.6} tid={0.8} />
        <Spets x={764} y={246} mot="hoger" spelar={spelar} delay={2.4} />

        {/* HUVUDBOK — staplade rader + "+"-spår, aldrig ändring */}
        <motion.g {...tona(spelar, 1.75)}>
          <Ruta x={766} y={122} b={124} h={186} />
          <Rubrik x={828} y={146} text="HUVUDBOK" />
          {[160, 178, 196, 214].map((y) => (
            <rect key={y} x={780} y={y} width={96} height={12} rx={2} fill={YTA_IS} />
          ))}
          <rect x={780} y={236} width={96} height={18} rx={3} fill="none" stroke={LINJE_STARK} strokeWidth={1} />
          <Sma x={828} y={248} text="+ rättelsepost" farg={INK_MJUK} />
          <Sma x={828} y={272} text="append-only" />
          <Sma x={828} y={285} text="aldrig ändring" />
        </motion.g>

        {/* Ljuspulsen — ovanpå flödeslinjerna, samma d som baslinjerna. */}
        {PULS_BRED.map((p) => (
          <Puls key={p.d} d={p.d} langd={p.langd} steg={p.steg} tid={p.tid} spelar={spelar} />
        ))}
      </g>
    </svg>
  );
}

/* ————— Smal variant: vertikalt flöde, 360×720 ————— */

function Smal({ spelar }: Props) {
  return (
    <svg
      className="ark-smal"
      viewBox="0 0 360 720"
      role="img"
      aria-label={ARIA}
      style={{ width: "100%", height: "auto" }}
    >
      <g aria-hidden="true">
        {/* Punkt 2: isoleringsramen — modellträning ligger utanför, till höger. */}
        <motion.path
          d="M12 14 H252 V706 H12 Z"
          fill="none"
          stroke={LINJE_STARK}
          strokeWidth={1}
          {...rita(spelar, 0, 1.8)}
        />
        <motion.g {...fram(spelar, 0.3)}>
          <rect x={18} y={7} width={194} height={14} fill={YTA} />
          <Sma x={24} y={17.5} anchor="start" spar="0.08em" text="RADNIVÅ-ISOLERING — ER VÄRLD" />
        </motion.g>

        {/* UNDERLAG */}
        <motion.g {...tona(spelar, 0.1)}>
          <Ruta x={82} y={40} b={100} h={80} />
          <Rubrik x={132} y={62} text="UNDERLAG" />
          <path d="M98 78 H166 M98 92 H166 M98 106 H150" fill="none" stroke={LINJE_STARK} strokeWidth={1} />
        </motion.g>

        <Linje d={FLODE_SMAL.underlagForslag} spelar={spelar} delay={0.25} tid={0.7} />
        <Spets x={132} y={150} mot="ner" spelar={spelar} delay={0.95} />

        {/* FÖRSLAG */}
        <motion.g {...tona(spelar, 0.4)}>
          <Ruta x={57} y={154} b={150} h={132} />
          <Rubrik x={132} y={176} text="FÖRSLAG" />
          {CHIPS.map((chip, i) => (
            <g key={chip}>
              <rect x={78} y={190 + i * 28} width={108} height={22} rx={4} fill={YTA_IS} />
              <Sma x={132} y={204.5 + i * 28} text={chip} farg={INK_MJUK} storlek={10} />
            </g>
          ))}
        </motion.g>

        {/* Punkt 3: bruten pil åt höger, ut genom ramen */}
        <Linje d="M207 205 H222" spelar={spelar} delay={0.6} tid={0.4} />
        <Linje d="M234 205 H250" spelar={spelar} delay={0.75} tid={0.3} />
        <motion.path
          d="M226 211 L232 199"
          fill="none"
          stroke={INK_MJUK}
          strokeWidth={1.25}
          strokeLinecap="round"
          {...fram(spelar, 0.95)}
        />
        <Spets x={257} y={205} mot="hoger" spelar={spelar} delay={1.05} />
        <motion.g {...tona(spelar, 0.85)}>
          <Ruta x={260} y={188} b={90} h={34} rund={6} fyllnad={YTA} />
          <Sma x={305} y={208.5} text="modellträning" storlek={8.5} />
          <path d="M266 218 L344 192" fill="none" stroke={INK_MJUK} strokeWidth={1.25} />
          <Sma x={305} y={240} text="tränar aldrig" />
          <Sma x={305} y={253} text="på er data" />
        </motion.g>

        <Linje d={FLODE_SMAL.forslagHash} spelar={spelar} delay={0.55} tid={0.7} />
        <Spets x={132} y={316} mot="ner" spelar={spelar} delay={1.25} />

        {/* HASH + punkt 1 (etiketten inne i noden i den smala varianten) */}
        <motion.g {...tona(spelar, 0.75)}>
          <Ruta x={44} y={320} b={176} h={68} />
          <Rubrik x={132} y={341} text="HASH" />
          <Data x={132} y={359} text={HASHTEXT} />
          <Sma x={132} y={377} text="en ändrad rad → obeslutbart" storlek={8.5} />
        </motion.g>

        {/* Förgreningen */}
        <Linje d={FLODE_SMAL.hashStam} spelar={spelar} delay={0.95} tid={0.6} />
        <Linje d={FLODE_SMAL.stamAttest} spelar={spelar} delay={1.1} tid={0.7} />
        <Spets x={74} y={460} mot="ner" spelar={spelar} delay={1.7} />
        <Linje d={FLODE_SMAL.stamPolicy} spelar={spelar} delay={1.2} tid={0.7} />
        <Spets x={190} y={460} mot="ner" spelar={spelar} delay={1.8} />

        {/* Punkt 4 — bredvid förgreningsstammen */}
        <motion.g {...tona(spelar, 1.35)}>
          <Sma x={140} y={402} anchor="start" text="mänsklig kontroll" storlek={8.5} />
          <Sma x={140} y={415} anchor="start" text="som mekanism" storlek={8.5} />
          <Sma x={140} y={428} anchor="start" text="(AI-förordningen)" storlek={8.5} />
        </motion.g>

        {/* ATTEST — accentnoden (den enda blå ytan) */}
        <motion.g {...tona(spelar, 1.3)}>
          <Ruta x={22} y={464} b={104} h={66} kant={BLA} tjocklek={1.5} />
          <Rubrik x={74} y={490} text="ATTEST" farg={BLA} />
          <Sma x={74} y={509} text="behörig människa" farg={BLA} storlek={8.5} />
        </motion.g>

        {/* POLICY */}
        <motion.g {...tona(spelar, 1.4)}>
          <Ruta x={138} y={464} b={104} h={66} kant={INK} tjocklek={1.25} />
          <Rubrik x={190} y={490} text="POLICY" />
          <Sma x={190} y={509} text="era regler" farg={INK_MJUK} />
        </motion.g>

        <Linje d={FLODE_SMAL.attestHuvudbok} spelar={spelar} delay={1.55} tid={0.5} />
        <Spets x={74} y={560} mot="ner" spelar={spelar} delay={2.0} />
        <Linje d={FLODE_SMAL.policyHuvudbok} spelar={spelar} delay={1.65} tid={0.5} />
        <Spets x={190} y={560} mot="ner" spelar={spelar} delay={2.1} />

        {/* HUVUDBOK */}
        <motion.g {...tona(spelar, 1.8)}>
          <Ruta x={42} y={564} b={180} h={128} />
          <Rubrik x={132} y={586} text="HUVUDBOK" />
          {[600, 616, 632].map((y) => (
            <rect key={y} x={58} y={y} width={148} height={12} rx={2} fill={YTA_IS} />
          ))}
          <rect x={58} y={650} width={148} height={18} rx={3} fill="none" stroke={LINJE_STARK} strokeWidth={1} />
          <Sma x={132} y={662} text="+ rättelsepost" farg={INK_MJUK} />
          <Sma x={132} y={682} text="append-only — aldrig ändring" storlek={8.5} />
        </motion.g>

        {/* Ljuspulsen — ovanpå flödeslinjerna, samma d som baslinjerna. */}
        {PULS_SMAL.map((p) => (
          <Puls key={p.d} d={p.d} langd={p.langd} steg={p.steg} tid={p.tid} spelar={spelar} />
        ))}
      </g>
    </svg>
  );
}

export default function ArkitekturFigur({ spelar }: Props) {
  return (
    <>
      <Bred spelar={spelar} />
      <Smal spelar={spelar} />
    </>
  );
}
