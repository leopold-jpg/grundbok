import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { withTenant } from "../src/lib/db/tenant";
import { skapaAgentNyckel } from "../src/lib/agent-auth";
import { exempelProposal } from "./helpers";
import { handleProposal, type Principal } from "../src/lib/decisions";
import {
  parsePostmarkInbound,
  taEmotInboundMejl,
  tenantUrAdress,
  listaKarantan,
} from "../src/lib/mejl/inbound";
import { laggTillAvsandare, taBortAvsandare, listaAvsandare } from "../src/lib/mejl/avsandare";
import { paminnMedMejl, skapaFraga } from "../src/lib/kompletteringar";
import { skapaKlientInbjudan, losInKlientInbjudan } from "../src/auth/klient-inbjudan";
import { kaffefaktura } from "../src/lib/exempel";

// WP23: mejladaptern. Inbound: generiskt payloadformat, adress→tenant,
// avsändarvakt → karantän utan innehåll. Outbound: Påminn mejlar det
// färdiga utkastet via adaptern (logg-transporten lokalt) och markerar
// raderna först efter lyckad sändning.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();

// Aktiv agent så att intake köar jobb (kedjan testas i intake.test.ts).
await skapaAgentNyckel(db, {
  tenantId: "kund_a",
  module: "bokforing",
  scopes: ["proposals:write"],
  namn: "mejl-worker-a",
});

function postmarkPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    FromFull: { Email: "Ekonomi@Kund-A.se" },
    ToFull: [{ Email: "kvitto+kund_a@inbound.grundbok.example" }],
    Subject: "VB: Faktura kaffe",
    TextBody: kaffefaktura("2026-07-10", 6),
    Attachments: [],
    ...overrides,
  };
}

test("parsePostmarkInbound + tenantUrAdress: payload → generiskt format → tenant", () => {
  const mejl = parsePostmarkInbound(postmarkPayload());
  assert.ok(mejl);
  assert.equal(mejl!.fran, "ekonomi@kund-a.se");
  assert.equal(tenantUrAdress(mejl!.till), "kund_a");

  // Trasig payload → null; adress utan kvitto+ → ingen tenant.
  assert.equal(parsePostmarkInbound("skräp"), null);
  assert.equal(parsePostmarkInbound({}), null);
  assert.equal(tenantUrAdress(["info@byran.se"]), null);
});

test("oregistrerad avsändare → karantän utan innehåll, aldrig underlag eller förslag", async () => {
  const mejl = parsePostmarkInbound(postmarkPayload())!;
  const utfall = await taEmotInboundMejl(db, mejl);
  assert.equal(utfall.status, "karantan");

  const karantan = await listaKarantan(db, "kund_a");
  assert.equal(karantan.length, 1);
  assert.equal(karantan[0].fran, "ekonomi@kund-a.se");

  // Inget underlag, inget förslag — och karantänraden bär inte texten.
  const underlag = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM underlag WHERE kalla = 'mejl'`),
  );
  assert.equal(Number(underlag.rows[0].n), 0);
});

test("registrerad avsändare → underlag med källa mejl; okänd klientadress ignoreras", async () => {
  await laggTillAvsandare(db, {
    tenantId: "kund_a",
    email: "ekonomi@kund-a.se",
    registreradAv: "klient:test",
  });

  const utfall = await taEmotInboundMejl(db, parsePostmarkInbound(postmarkPayload())!);
  assert.equal(utfall.status, "mottaget");
  assert.ok(utfall.status === "mottaget" && utfall.underlag.length === 1);

  const underlag = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ kalla: string; inlamnad_av: string }>(
      `SELECT kalla, inlamnad_av FROM underlag WHERE id = $1`,
      [utfall.status === "mottaget" ? utfall.underlag[0].underlag_id : ""],
    ),
  );
  assert.equal(underlag.rows[0].kalla, "mejl");
  assert.equal(underlag.rows[0].inlamnad_av, "mejl:ekonomi@kund-a.se");

  // Okänd tenant-slug: ignoreras tyst — inget läcker om vilka som finns.
  const okand = await taEmotInboundMejl(
    db,
    parsePostmarkInbound(
      postmarkPayload({ ToFull: [{ Email: "kvitto+finns_inte@inbound.grundbok.example" }] }),
    )!,
  );
  assert.equal(okand.status, "ignorerad");
});

test("bilagor: ett underlag per bilaga, ostödd filtyp hoppas utan att stoppa de övriga", async () => {
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const mejl = parsePostmarkInbound(
    postmarkPayload({
      Attachments: [
        { Name: "kvitto1.png", ContentType: "image/png", Content: pixel },
        { Name: "virus.zip", ContentType: "application/zip", Content: "aGVq" },
        // Annat innehåll → annan content-hash → eget underlag.
        {
          Name: "kvitto2.png",
          ContentType: "image/png",
          Content: pixel.slice(0, -4) + "gg==",
        },
      ],
    }),
  )!;
  const utfall = await taEmotInboundMejl(db, mejl);
  assert.equal(utfall.status, "mottaget");
  if (utfall.status !== "mottaget") return;
  assert.equal(utfall.underlag.length, 2);
  assert.equal(utfall.hoppade_bilagor.length, 1);
  assert.match(utfall.hoppade_bilagor[0], /virus\.zip/);
});

test("avsändare kan tas bort — nästa mejl hamnar i karantän igen", async () => {
  const lista = await listaAvsandare(db, "kund_a");
  const rad = lista.find((a) => a.email === "ekonomi@kund-a.se")!;
  await taBortAvsandare(db, {
    tenantId: "kund_a",
    avsandareId: rad.id,
    borttagenAv: "klient:test",
  });

  const utfall = await taEmotInboundMejl(
    db,
    parsePostmarkInbound(postmarkPayload({ Subject: "efter borttag" }))!,
  );
  assert.equal(utfall.status, "karantan");
});

test("Påminn (WP23): mejlas via adaptern till klientanvändarna, raderna markeras efter sändning", async () => {
  // En öppen kompletteringsrad att påminna om.
  const principal: Principal = {
    typ: "intern",
    tenant_id: "kund_a",
    module: "bokforing",
    scopes: ["proposals:write"],
    namn: "test",
  };
  const p = exempelProposal();
  await handleProposal(db, principal, p);
  await skapaFraga(db, {
    tenantId: "kund_a",
    proposalId: p.id,
    fraga: "Vad avser fakturan?",
    stalldAv: "konsult:test",
  });

  // Ingen klientanvändare ännu → tydligt fel, raden förblir 'open'.
  await assert.rejects(
    paminnMedMejl(db, { tenantId: "kund_a", paminddAv: "konsult:test" }),
    /Ingen klientanvändare/,
  );
  const fore = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ status: string }>(`SELECT status FROM kompletteringar`),
  );
  assert.ok(fore.rows.every((r) => r.status === "open"));

  // Klientanvändare på plats (WP20) → mejlet loggas och raderna markeras.
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "paminn@kund-a.se",
    skapadAv: "konsult:test",
  });
  await losInKlientInbjudan(db, {
    token: inbjudan.token,
    namn: "Påminn Mottagare",
    losenord: "klientlosen-7",
  });

  const utfall = await paminnMedMejl(db, { tenantId: "kund_a", paminddAv: "konsult:test" });
  assert.equal(utfall.antal, 1);
  assert.deepEqual(utfall.till, ["paminn@kund-a.se"]);
  assert.equal(utfall.adapter, "logg");

  const efter = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ status: string }>(`SELECT status FROM kompletteringar`),
  );
  assert.ok(efter.rows.every((r) => r.status === "paminnd"));

  // Spårraden: vad som mejlades till vem, tenant-scopat.
  const mejl = await withTenant(db, "kund_a", (tx) =>
    tx.query<{ till: string[]; amne: string; adapter: string; brodtext: string }>(
      `SELECT till, amne, adapter, brodtext FROM utgaende_mejl`,
    ),
  );
  assert.equal(mejl.rows.length, 1);
  assert.equal(mejl.rows[0].adapter, "logg");
  assert.match(mejl.rows[0].amne, /Komplettering/);
  assert.match(mejl.rows[0].brodtext, /Vad avser fakturan\?/);

  // kund_b ser aldrig kund_a:s utgående mejl (RLS).
  const b = await withTenant(db, "kund_b", (tx) =>
    tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM utgaende_mejl`),
  );
  assert.equal(Number(b.rows[0].n), 0);
});
