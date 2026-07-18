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

test("löne-sammansättningar hör till lön, inte reskontran (granskningsfynd)", () => {
  // "betalningar" är ett reskontra-ord — lönevikten måste ändå vinna.
  assert.equal(foreslaAgentDraft("lönebetalningar varje månad")?.mallId, "lon");
  assert.equal(foreslaAgentDraft("lönehantering")?.mallId, "lon");
  assert.equal(foreslaAgentDraft("löneadministration för personalen")?.mallId, "lon");
});

test("lika poäng bryts mot först-deklarerad roll — breda basrollen", () => {
  // /kvitto/ (2) mot /faktur/ (2): tvetydigt → bokforing, deterministiskt.
  assert.equal(foreslaAgentDraft("fakturor och kvitton")?.mallId, "bokforing");
});

test("vikterna avgör när ordräkning hade gett fel roll", () => {
  // Ordräkning: 2–2 (bokfor+kvitto mot leverantor+faktur) → tie.
  // Vikterna: 3 mot 5 → reskontran, som beskrivningen faktiskt avser.
  assert.equal(
    foreslaAgentDraft("bokföra kvitton och leverantörsfakturor")?.mallId,
    "leverantorsreskontra",
  );
});

test("namnledet hoppar stoppord och ALLA rollers nyckelord", () => {
  // "från" är stoppord — namnet ska bära "butiken", inte "fran".
  assert.equal(foreslaAgentDraft("kvitton från butiken")?.namn, "bokforing-butiken");
  // "varje"/"månad" är fyllnadsord → fallback, aldrig "lon-varje".
  assert.equal(foreslaAgentDraft("payroll varje månad")?.namn, "lon-agent");
  // Andra rollers nyckelord ("bokföra") duger inte som namnled.
  assert.equal(
    foreslaAgentDraft("bokföra kvitton och leverantörsfakturor")?.namn,
    "leverantorsreskontra-agent",
  );
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
