import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { maskera, maskeraLangfuseAttribut, MASKERAT } from "../src/lib/observability/mask";
import { initLangfuse, flushLangfuse, langfuseAktiv } from "../src/lib/observability/langfuse";
import { tolka } from "../src/lib/extract";
import { kaffefaktura } from "../src/lib/exempel";

// Observability-tester (kraven i Langfuse-uppdraget):
//
//   1. MASKERINGSLÅSET — fakturainnehåll (underlagstext, motpartsnamn,
//      belopp) når ALDRIG payloaden som lämnar processen. Testas mot den
//      RIKTIGA LangfuseSpanProcessor:n med riktig mask-krok och en
//      in-memory-exporter i stället för nätet: det som står i exporterns
//      spans är exakt det som skulle ha skickats till Langfuse.
//   2. NO-OP UTAN NYCKLAR — utan LANGFUSE_* i miljön får init/flush aldrig
//      kasta och applikationsflödet ska ge identiskt resultat.
//
// Ordningen är medveten: no-op-testet körs FÖRE låstestet, som registrerar
// en riktig OTel-provider globalt i processen.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";
delete process.env.LANGFUSE_PUBLIC_KEY;
delete process.env.LANGFUSE_SECRET_KEY;
delete process.env.LANGFUSE_BASE_URL;

// ---------------------------------------------------------------------------
// Krav 2: no-op utan nycklar — observability får aldrig fälla ett jobb.
// ---------------------------------------------------------------------------

test("utan LANGFUSE-nycklar: init är no-op, flush kastar inte, flödet opåverkat", async () => {
  assert.equal(langfuseAktiv(), false);
  await initLangfuse(); // får inte kasta
  await flushLangfuse(); // får inte kasta

  // Hela den instrumenterade kodvägen (startActiveObservation +
  // startObservation) körs mot OTel:s noop-tracer och ska ge exakt samma
  // resultat som utan instrumentering.
  const resultat = await tolka(kaffefaktura("2026-07-08", 6));
  assert.equal(resultat.motor, "fallback");
  assert.equal(resultat.extraktion.netto_ore, 100_000);
  assert.match(resultat.extraktion.motpart, /Kafferosteriet/);
});

// ---------------------------------------------------------------------------
// Maskeringens enhetssemantik (allowlist).
// ---------------------------------------------------------------------------

test("maskera: underlagstext, motpartsnamn och belopp ersätts med [MASKERAT]", () => {
  const maskad = maskera({
    underlag: "FAKTURA Kafferosteriet Exempel AB 1 000,00 kr",
    extraktion: {
      motpart: "Kafferosteriet Exempel AB",
      beskrivning: "Kaffebönor, mörkrost",
      netto_ore: 100_000,
      moms_ore: 6_000,
      kategori: "livsmedel",
      forskott: false,
    },
    saldo: { konto: "4010", ore: 106_000 },
  }) as Record<string, unknown>;

  assert.equal(maskad.underlag, MASKERAT);
  const e = maskad.extraktion as Record<string, unknown>;
  assert.equal(e.motpart, MASKERAT);
  assert.equal(e.beskrivning, MASKERAT);
  assert.equal(e.netto_ore, MASKERAT);
  assert.equal(e.moms_ore, MASKERAT);
  assert.equal(e.kategori, "livsmedel"); // enum-låst beslutsmetadata
  assert.equal(e.forskott, false); // booleans kan inte bära innehåll
  const s = maskad.saldo as Record<string, unknown>;
  assert.equal(s.konto, "4010"); // kontonummer = beslutsmetadata
  assert.equal(s.ore, MASKERAT); // belopp maskeras alltid
});

test("maskera: beslutsmetadata, flagg-identitet, konfidens och promptversion går omaskerat", () => {
  const maskad = maskera({
    motor: "anthropic",
    model: "claude-opus-4-8",
    status: "auto_approved",
    konfidens: 0.9,
    prompt_hash: "abc123",
    mall_id: "bokforing-standard",
    mall_version: "1.2.0",
    flaggor: [{ id: "anomaly_amount", niva: "varning", text: "3× median för Kafferosteriet" }],
  }) as Record<string, unknown>;

  assert.equal(maskad.motor, "anthropic");
  assert.equal(maskad.model, "claude-opus-4-8");
  assert.equal(maskad.status, "auto_approved");
  assert.equal(maskad.konfidens, 0.9);
  assert.equal(maskad.prompt_hash, "abc123");
  assert.equal(maskad.mall_id, "bokforing-standard");
  assert.equal(maskad.mall_version, "1.2.0");
  const flagga = (maskad.flaggor as Record<string, unknown>[])[0];
  assert.equal(flagga.id, "anomaly_amount"); // regelidentiteten synlig
  assert.equal(flagga.niva, "varning");
  assert.equal(flagga.text, MASKERAT); // fritext kan citera fakturan → maskas
});

test("maskera: rå sträng i roten och ogiltig JSON helmaskas — okända fält läcker aldrig", () => {
  assert.equal(maskera("FAKTURA Kafferosteriet"), MASKERAT);
  assert.equal(maskeraLangfuseAttribut("inte json {"), MASKERAT);
  assert.equal(
    JSON.parse(maskeraLangfuseAttribut('{"helt_nytt_falt":"Kafferosteriet"}') as string).helt_nytt_falt,
    MASKERAT,
  );
});

// ---------------------------------------------------------------------------
// Krav 1: MASKERINGSLÅSET mot riktiga exportpayloaden.
// ---------------------------------------------------------------------------

test("fakturainnehåll når aldrig Langfuse-payloaden (riktig processor, in-memory-exporter)", async () => {
  const exporter = new InMemorySpanExporter();
  const processor = new LangfuseSpanProcessor({
    exporter,
    mask: ({ data }) => maskeraLangfuseAttribut(data),
    mediaUploadEnabled: false,
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();

  const faktura = kaffefaktura("2026-07-08", 6);
  const resultat = await tolka(faktura);
  assert.equal(resultat.motor, "fallback");
  await processor.forceFlush();

  const spans = exporter.getFinishedSpans();
  assert.ok(spans.length >= 1, "minst tolknings-spannet ska exporteras");

  // Payloaden som skulle ha lämnat processen, i sin helhet.
  const payload = JSON.stringify(spans.map((s) => ({ name: s.name, attributes: s.attributes })));

  // Fakturainnehåll: motpartsnamn, org.nr, varutext, formaterade belopp.
  for (const kansligt of [
    "Kafferosteriet",
    "556999-0001",
    "Kaffebönor",
    "1 000,00",
    "1 060,00",
    "Bankgiro",
  ]) {
    assert.ok(!payload.includes(kansligt), `payloaden får inte innehålla "${kansligt}"`);
  }
  // Belopp i ören som tal (":100000" träffar aldrig hex-trace-id:n).
  for (const belopp of [":100000", ":6000", ":106000"]) {
    assert.ok(!payload.includes(belopp), `payloaden får inte innehålla beloppet "${belopp}"`);
  }

  // Maskeringen har skett — och det som SKA vara kvar är kvar.
  assert.ok(payload.includes(MASKERAT), "maskerade fält ska vara [MASKERAT]");
  // Attributvärdena är JSON-strängar — citattecknen är escapade i payloaden.
  assert.ok(payload.includes('motor\\":\\"fallback'), "motor är beslutsmetadata och ska synas");
  assert.ok(payload.includes("livsmedel"), "enum-låst kategori ska synas");
});
