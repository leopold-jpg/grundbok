// Adapter-gränssnittet visar var den riktiga integrationen pluggas in —
// riktiga Fortnox är uttryckligen inte kvällens jobb (ULTRAPLAN §9).
// Riktig implementation autentiserar via secret_ref i kundens config
// (nyckeln hämtas ur kundmiljöns secret store, aldrig ur configen själv).

export interface Bokforingsintegration {
  registreraVerifikation(input: {
    tenantId: string;
    nummer: number;
    affarshandelsedatum: string;
  }): Promise<{ extern_ref: string }>;
}

export class FortnoxMock implements Bokforingsintegration {
  async registreraVerifikation(input: {
    tenantId: string;
    nummer: number;
    affarshandelsedatum: string;
  }): Promise<{ extern_ref: string }> {
    const ar = input.affarshandelsedatum.slice(0, 4);
    return { extern_ref: `FTX-MOCK-${ar}-${String(input.nummer).padStart(4, "0")}` };
  }
}

export function bokforingsadapter(): Bokforingsintegration {
  return new FortnoxMock();
}
