# Kickoff-tillägg — runtime & provisionering (WP8–WP10)

Fortsättning på CLAUDE-CODE-KICKOFF.md. Läs först
`docs/adr/0003-serverless-multitenant-runtime.md` (flytta dit från
repo-roten om den ligger kvar där, uppdatera ADR-index).
Samma regler: committa per paket, npm test grönt mellan varje.

## WP8 — control plane: agents-tabellen

Migration för tabellen `agents` (ersätter/absorberar `agent_keys` från WP4
— slå ihop om WP4 redan skapat den):

```sql
create table agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  module text not null,              -- ModuleId
  display_name text not null,        -- "Bokföringsagent — Bygg Exempel AB"
  key_hash text not null unique,     -- sha256 av API-nyckeln, aldrig klartext
  scopes text[] not null,
  policy_id uuid references autonomy_policies(id),
  status text not null default 'active'
    check (status in ('active','paused','canceled')),
  provisioned_by text not null,      -- konsult-id eller 'stripe:<event_id>'
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

RLS: tenant-scopad läsning; skrivning endast via service role.
Auth-middleware från WP4 ändras till att slå upp mot `agents` och
kräva `status = 'active'`.

## WP9 — data plane: kö + worker-stomme

1. Aktivera pgmq i Supabase, kö `agent_jobs`. Meddelandeformat:
   `{ job_id, tenant_id, agent_id, module, trigger, payload_ref }`
   där payload_ref är en storage-URI (aldrig rå underlagsdata i kön).
2. `src/workers/run-agent.ts` — EN generisk worker, ren funktion:
   - läs job → slå upp agent-raden (status active, annars ack+skip)
   - ladda tenantens policy + modulens skill
   - hämta underlag från storage-URI
   - anropa modulens `buildProposal(input): Proposal` (rent interface —
     samma funktion ska kunna köras av OpenClaw lokalt i dev)
   - POST /api/proposals med agentens nyckel
   - idempotens: proposal.id deriveras deterministiskt från job_id
     (uuid v5) så omkörning aldrig ger dubbletter
3. Per-tenant concurrency-tak (max N samtidiga jobb per tenant, läses
   från agents-raden eller default 2).
4. Cron-stub: `src/workers/cron.ts` som pollar kön (Vercel cron/Edge
   Function-kompatibel). Ingen deploy i denna session — bara körbar
   lokalt via `npm run worker`.

## WP10 — provisionering: agent på en sekund

1. `POST /api/agents` (endast konsultroll): body { tenant_id, module,
   display_name, policy } → skapar rad, genererar nyckel, returnerar
   nyckeln EN gång i svaret (visas aldrig igen), audit-loggar.
2. `DELETE /api/agents/:id` → status 'canceled' + revoked_at (aldrig
   hård delete — beslutshistoriken refererar agenten).
3. Adminkonsolen: agentvy per tenant — lista, skapa (modal med modul +
   policyval), pausa/avsluta, "kopiera nyckel"-flöde vid skapande.
4. Stripe-förberedelse (INGEN Stripe-integration nu): skapandet bryts ut
   till `provisionAgent(input, provisioned_by)` som både API-routen och
   en framtida webhook kan anropa. Lägg fältet `price_ref` (nullable) i
   ModuleManifest.

## Smoke-tester (utökar WP7)

- Paused/canceled agent → 403 på POST /api/proposals
- Samma job kört två gånger → exakt en proposal
- Tenant A:s jobb kan inte referera tenant B:s agent
- Nyckel returneras aldrig i någon läs-endpoint (endast hash lagras)

## WP11 — konsult-auth (dokumenterat icke-mål ikväll)

Riktig konsultautentisering via Supabase Auth. `decided_by` måste vara en
verifierad identitet — sessionsbunden, granskningsbar — innan första
riktiga kund; hårdkodade `konsult@byran.se` duger bara i v0. Omfattar:
inloggning för konsultytan (/admin + beslutsroutes), koppling
konsult ↔ byrå ↔ tenants, och att beslutsmotorn vägrar beslut utan
autentiserad principal. Tas i separat session; inget av WP8–WP10 får
bygga bort möjligheten (decided_by är redan en fri identitetssträng i
decisions-tabellen).

## Icke-mål

Stripe-checkout, Inngest/Trigger.dev, e-post/foto-triggers, deploy till
Vercel/Supabase-moln, konsult-auth (WP11 ovan). Allt ska gå att köra
lokalt; deploy tas i separat session när WP1–10 är gröna.
