import { test } from "node:test";
import assert from "node:assert/strict";
import { foreslaAgentDraft } from "../src/mallar/agentdraft";
import { MALL_IDS } from "../src/mallar/registry";

// AgentDraft (kompletteringspass): fri beskrivning → regelbaserat förslag
// (mallId, namn) ur mallregistret. Ingen LLM — samma text ger alltid
// samma förslag, och inget förslag alls är ett giltigt utfall.

test("kickoff-exemplet: 'bokföring för min byggfirma' → bokforing + namnled", () => {
  const f = foreslaAgentDraft("bokföring för min byggfirma");
  assert.ok(f);
  assert.equal(f!.mallId, "bokforing");
  assert.equal(f!.namn, "bokforing-byggfirma");
});

test("specifik roll slår basrollen: leverantörsfakturor → reskontran", () => {
  const f = foreslaAgentDraft("bokför våra leverantörsfakturor och betalningar");
  assert.equal(f?.mallId, "leverantorsreskontra");
});

test("lön och skatt känns igen på sina nyckelord", () => {
  assert.equal(foreslaAgentDraft("löner för våra anställda")?.mallId, "lon");
  assert.equal(foreslaAgentDraft("payroll varje månad")?.mallId, "lon");
  assert.equal(foreslaAgentDraft("momsdeklaration och skatt")?.mallId, "skatt-compliance");
});

test("förslagets mallId finns alltid i registret", () => {
  for (const text of [
    "kvitton från butiken",
    "leverantörsreskontra",
    "semester och arbetsgivaravgifter",
    "compliance och deklarationsfrister",
  ]) {
    const f = foreslaAgentDraft(text);
    assert.ok(f, `"${text}" ska ge ett förslag`);
    assert.ok((MALL_IDS as readonly string[]).includes(f!.mallId));
  }
});

test("ingen träff → null, aldrig en gissning", () => {
  assert.equal(foreslaAgentDraft("hjälp med hemsidan"), null);
  assert.equal(foreslaAgentDraft(""), null);
  assert.equal(foreslaAgentDraft("   "), null);
});

test("namnet faller tillbaka på -agent när beskrivningen bara är rollord", () => {
  const f = foreslaAgentDraft("kvitton");
  assert.equal(f?.namn, "bokforing-agent");
});
