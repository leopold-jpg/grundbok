import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Skills-biblioteket är källan till både LLM-kontext (SKILL.md) och
// deterministiska regler (rules.json). Loadern läser rules.json —
// det ClawKeeper aldrig byggde: deras skills laddas inte av koden alls,
// och openaccountants regler exekveras bara av LLM:en via prompt.
// grundbok gör skillen maskinexekverbar (ULTRAPLAN §1).

const REPO_ROOT = process.cwd();

export type MomsPeriod = {
  from: string | null;
  to: string | null;
  sats: number;
  lagrum: string;
};

export type MomsRules = {
  skill: string;
  version: string;
  kategorier: Record<string, { label: string; satser: MomsPeriod[] }>;
  kategorialias: Record<string, string>;
  konton: {
    utgaende: Record<string, string>;
    ingaende: string;
    omvand: { utgaende_25: string; ingaende: string };
  };
  omvand_betalningsskyldighet: {
    bygg: {
      lagrum: string;
      villkor: string;
      sats: number;
      kostnadskonto: string;
      deklarationsrutor: { underlag: string; utgaende: string; ingaende: string };
      aktiveras_av_config: string;
    };
  };
};

export type KonteringRules = {
  skill: string;
  version: string;
  motkonton: Record<string, { konto: string; namn: string }>;
  kostnadskonton: Record<string, { konto: string; namn: string; not?: string }>;
};

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf8")) as T;
}

export function loadMomsRules(): MomsRules {
  return loadJson<MomsRules>("skills/se/moms/rules.json");
}

export function loadKonteringRules(): KonteringRules {
  return loadJson<KonteringRules>("skills/se/bas-kontering/rules.json");
}

export type KundConfig = {
  schema_version: string;
  tenant_id: string;
  namn: string;
  mall: { id: string; version: string };
  skills: Record<string, { version: string; config: Record<string, unknown> }>;
  approval: { auto_godkann: false; beloppsgrans_flagga_sek?: number };
  /** Kända ordervärden (WP32, ÄTA-vaksamhet): orderreferens → värde i
   *  ören. Läses av granskningsmotorn när bygg-paketet är aktivt. */
  ordrar?: Record<string, number>;
};

const kundConfigCache = new Map<string, KundConfig>();

export function loadKundConfig(tenantId: string): KundConfig {
  const cached = kundConfigCache.get(tenantId);
  if (cached) return cached;
  for (const file of readdirSync(join(REPO_ROOT, "customers"))) {
    if (!file.endsWith(".config.json")) continue;
    const config = loadJson<KundConfig>(join("customers", file));
    if (config.approval?.auto_godkann !== false) {
      // Schemat säger const:false — detta är bältet till hängslena.
      throw new Error(
        `Ogiltig kundconfig ${file}: auto_godkann måste vara false (ansvarsprincipen, ULTRAPLAN §6)`,
      );
    }
    kundConfigCache.set(config.tenant_id, config);
  }
  const found = kundConfigCache.get(tenantId);
  if (!found) throw new Error(`Okänd tenant: ${tenantId}`);
  return found;
}

/** Vilka skill-versioner som gäller just nu — stämplas på varje förslag. */
export function skillVersions(): Record<string, string> {
  const moms = loadMomsRules();
  const kontering = loadKonteringRules();
  return { [moms.skill]: moms.version, [kontering.skill]: kontering.version };
}
