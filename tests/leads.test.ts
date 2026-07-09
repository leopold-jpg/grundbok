import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/lib/db/client";
import { sparaLead, valideraLead } from "../src/ytor/leads";

// WP12: kontaktboxen på publika sajten — validering + service-vägens insert.

const db = await createDb();

test("valideraLead: kräver namn, byrå och giltig e-post", () => {
  assert.equal(valideraLead(null), "ogiltig JSON");
  assert.equal(valideraLead({ byra: "B", email: "a@b.se" }), "namn krävs");
  assert.equal(valideraLead({ namn: "A", email: "a@b.se" }), "byrå krävs");
  assert.equal(
    valideraLead({ namn: "A", byra: "B", email: "inte-en-adress" }),
    "en giltig e-postadress krävs",
  );
  assert.equal(valideraLead({ namn: "A", byra: "B", email: "a@b.se" }), null);
  assert.equal(
    valideraLead({ namn: "A", byra: "B", email: "a@b.se", meddelande: 7 }),
    "meddelandet måste vara text",
  );
  assert.equal(
    valideraLead({ namn: "A", byra: "B", email: "a@b.se", meddelande: "x".repeat(4001) }),
    "meddelandet får vara högst 4000 tecken",
  );
});

test("sparaLead: lagrar trimmat, tomt meddelande blir null", async () => {
  const { id } = await sparaLead(db, {
    namn: "  Test Person  ",
    byra: "Testbyrån AB",
    email: " test@exempel.se ",
    meddelande: "  ",
  });
  const r = await db.query<{ namn: string; email: string; meddelande: string | null }>(
    `SELECT namn, email, meddelande FROM leads WHERE id = $1`,
    [id],
  );
  assert.equal(r.rows[0].namn, "Test Person");
  assert.equal(r.rows[0].email, "test@exempel.se");
  assert.equal(r.rows[0].meddelande, null);
});
