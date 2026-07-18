import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { kontera } from "../src/lib/kontering";
import { byggBokforingsProposal, bokforingsKonfidens } from "../src/lib/bokforing-modul";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { OBSERVATIONS_DEFAULTS, type Extraktion } from "../src/lib/extract/schema";

// WP3: v1-flödets assertions — nu genom förslagskontraktet. Samma
// beteenden som gamla ledger.test.ts, men enda vägen till huvudboken
// är beslutsmotorn.

const db = await createDb();

const extraktion: Extraktion = {
  ...OBSERVATIONS_DEFAULTS,
  motpart: "Kafferosteriet Exempel AB",
  beskrivning: "Kaffebönor, mörkrost 20 kg",
  datum: "2026-07-08",
  netto_ore: 100_000,
  moms_ore: 6_000,
  brutto_ore: 106_000,
  momssats_angiven: 6,
  kategori: "livsmedel",
  betalsatt: "faktura",
};

function principal(tenantId: string): Principal {
  return {
    typ: "intern",
    tenant_id: tenantId,
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "modul:bokforing (test)",
  };
}

async function skapaPendingProposal(tenantId: string) {
  const forslag = kontera(extraktion, tenantId);
  const documentId = await withTenant(db, tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, raw) VALUES ($1, 'test') RETURNING id`,
      [tenantId],
    );
    return r.rows[0].id;
  });
  const proposal = byggBokforingsProposal({
    tenantId,
    documentId,
    extraktion,
    forslag,
    motor: "fallback",
    motorDetalj: "test",
  });
  const resultat = await handleProposal(db, principal(tenantId), proposal);
  // Default-policyn (seedad) auto-godkänner ingenting → pending.
  assert.equal(resultat.status, "pending");
  return proposal;
}

test("konfidensheuristiken: LLM > fallback, varningsflaggor sänker", () => {
  const rent = kontera(extraktion, "kund_a");
  assert.equal(bokforingsKonfidens("anthropic", rent), 0.9);
  assert.equal(bokforingsKonfidens("fallback", rent), 0.7);
  // Datumväxling mot dokumentets moms → varningsflagga → lägre konfidens.
  const flaggat = kontera(extraktion, "kund_a", "2026-03-15");
  assert.ok(flaggat.flaggor.some((f) => f.niva === "varning"));
  assert.ok(bokforingsKonfidens("anthropic", flaggat) < 0.9);
});

test("godkännande bokför: verifikation med löpnummer 1, balanserade rader, extern ref, proposal-spårning", async () => {
  const proposal = await skapaPendingProposal("kund_a");
  const utfall = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: proposal.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  assert.equal(utfall.outcome, "approved");
  if (utfall.outcome !== "approved" || !utfall.verifikation) return;
  assert.equal(utfall.verifikation.nummer, 1);
  assert.match(utfall.verifikation.extern_ref, /^FTX-MOCK-2026-0001$/);

  const rader = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ debet_ore: number; kredit_ore: number }>(
      `SELECT debet_ore, kredit_ore FROM verification_rows WHERE verification_id = $1`,
      [utfall.verifikation!.id],
    ),
  );
  const debet = rader.rows.reduce((s, r) => s + Number(r.debet_ore), 0);
  const kredit = rader.rows.reduce((s, r) => s + Number(r.kredit_ore), 0);
  assert.equal(debet, kredit);
  assert.equal(debet, 106_000);

  // Verifikationen spårar förslaget — och därmed modell + skill-versioner.
  const spar = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ proposal_id: string; skill_versions: Record<string, string> }>(
      `SELECT proposal_id, skill_versions FROM verifications WHERE id = $1`,
      [utfall.verifikation!.id],
    ),
  );
  assert.equal(spar.rows[0].proposal_id, proposal.id);
  assert.equal(spar.rows[0].skill_versions["se/moms"], "1.1.0");
});

test("löpnummer är tenant-scopat: kund_b börjar på 1 oavsett kund_a", async () => {
  const proposal = await skapaPendingProposal("kund_b");
  const utfall = await decideProposal(db, {
    tenantId: "kund_b",
    proposalId: proposal.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  if (utfall.outcome === "approved") assert.equal(utfall.verifikation!.nummer, 1);
});

test("avvisat förslag bokförs inte", async () => {
  const proposal = await skapaPendingProposal("kund_a");
  const utfall = await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: proposal.id,
    outcome: "rejected",
    decidedBy: "konsult@byran.se",
    reason: "Fel underlag",
  });
  assert.equal(utfall.outcome, "rejected");
  const status = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ status: string }>(`SELECT status FROM proposals WHERE id = $1`, [proposal.id]),
  );
  assert.equal(status.rows[0].status, "rejected");
});

test("samma förslag kan inte beslutas två gånger", async () => {
  const proposal = await skapaPendingProposal("kund_a");
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: proposal.id,
    outcome: "approved",
    decidedBy: "konsult@byran.se",
  });
  await assert.rejects(
    decideProposal(db, {
      tenantId: "kund_a",
      proposalId: proposal.id,
      outcome: "approved",
      decidedBy: "konsult@byran.se",
    }),
    /redan/,
  );
});

test("konsult i fel tenant-kontext når inte förslaget alls (RLS)", async () => {
  const proposal = await skapaPendingProposal("kund_a");
  await assert.rejects(
    decideProposal(db, {
      tenantId: "kund_b",
      proposalId: proposal.id,
      outcome: "approved",
      decidedBy: "konsult@byran.se",
    }),
    /finns inte/,
  );
});
