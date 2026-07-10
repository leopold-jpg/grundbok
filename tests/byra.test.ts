import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { PgliteAuth } from "../src/auth/pglite-auth";
import { handleProposal, decideProposal, type Principal } from "../src/lib/decisions";
import { attestKo, beslutsLogg, klientAgenter } from "../src/ytor/byra";
import { exempelProposal } from "./helpers";

// WP13: byråns arbetsyta — ytlogiken ovanpå kärnans läshjälpare.
// Byrå-scopning, "alla"-läget och namn-uppslaget av decided_by.

const db = await createDb();
const auth = new PgliteAuth(db);

const principal: Principal = {
  typ: "intern",
  tenant_id: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "test",
};

const inloggning = await auth.login("konsult.ett@byran-exempel.se", "grundbok-dev");
const session = (await auth.session(inloggning!.token))!;

test("attestKo: 'alla' samlar byråns klienter; okänd klient ger tomt, inte fel", async () => {
  const pa = exempelProposal();
  const pb = exempelProposal({
    tenant_id: "kund_b",
    id: "00000000-0000-4000-8000-00000000b0b1",
  });
  assert.equal((await handleProposal(db, principal, pa)).status, "pending");
  assert.equal(
    (await handleProposal(db, { ...principal, tenant_id: "kund_b" }, pb)).status,
    "pending",
  );

  const alla = await attestKo(db, session, "alla");
  assert.ok(alla.some((r) => r.id === pa.id && r.tenant_namn === "Café Exempel AB"));
  assert.ok(alla.some((r) => r.id === pb.id));

  const bara_a = await attestKo(db, session, "kund_a");
  assert.ok(bara_a.every((r) => r.tenant_id === "kund_a"));

  // Tenant utanför byrån (eller påhittad): tom lista — inget läcker.
  assert.deepEqual(await attestKo(db, session, "annan_byras_kund"), []);
});

test("beslutsLogg: decided_by slås upp till konsultens namn; policy-beslut märks", async () => {
  const ko = await attestKo(db, session, "kund_a");
  const rad = ko[0];
  await decideProposal(db, {
    tenantId: "kund_a",
    proposalId: rad.id,
    outcome: "approved",
    decidedBy: session.user.id,
  });

  const logg = await beslutsLogg(db, session, "kund_a");
  const beslutet = logg.find((l) => l.proposal_id === rad.id);
  assert.ok(beslutet);
  assert.equal(beslutet!.beslutad_av, "Konsult Ett Exempel");
  assert.equal(beslutet!.policy_beslut, false);
  assert.equal(beslutet!.tenant_namn, "Café Exempel AB");
});

test("klientAgenter: läsvy utan nyckeldata", async () => {
  const agenter = await klientAgenter(db, "kund_a");
  for (const a of agenter) {
    assert.ok(!("key_hash" in a));
    assert.ok(!("scopes" in a));
  }
});
