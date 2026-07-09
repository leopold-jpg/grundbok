#!/usr/bin/env python3
"""End-to-end-verifiering av grundboks tre ytor mot en körande dev-server.

Förutsätter FÄRSK dev-databas (verifikationsnummer antas börja på 1):
    rm -rf .data && npm run dev
Kör sedan:  python3 scripts/e2e.py

Kedjan: publik sajt + leads → auth-gränser (redirects, 401/403, rivna
API:er) → konsultens flöde (intag, momsväxling, attest, rättelse, bygg,
chatt) → byrå-gränsen via URL-manipulation → operatörens värld (aggregat,
mallar, provisionering, rotation, pausning) → policyöppning → auto-
bokföring → beslutslogg med verifierade identiteter.
"""
import json
import sys
import urllib.request
import urllib.error

BAS = "http://localhost:3456"
resultat = []


class IngenRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(IngenRedirect)


def anropa(metod, path, body=None, cookie=None, nyckel=None, rahtml=False):
    headers = {"content-type": "application/json"}
    if cookie:
        headers["cookie"] = cookie
    if nyckel:
        headers["authorization"] = f"Bearer {nyckel}"
    req = urllib.request.Request(
        BAS + path,
        method=metod,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with opener.open(req, timeout=120) as r:
            data = r.read()
            headers_ut = {k.lower(): v for k, v in r.headers.items()}
            return r.status, data.decode() if rahtml else json.loads(data), headers_ut
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            tolkad = data.decode() if rahtml else json.loads(data)
        except Exception:
            tolkad = data.decode(errors="replace")[:200]
        return e.code, tolkad, {k.lower(): v for k, v in e.headers.items()}


def kontroll(namn, ok, detalj=""):
    resultat.append((namn, ok, detalj))
    print(f"{'PASS' if ok else 'FAIL'}  {namn}" + (f"  ({detalj})" if detalj and not ok else ""))


def logga_in(email):
    st, svar, headers = anropa(
        "POST", "/api/auth/login", {"email": email, "password": "grundbok-dev"}
    )
    assert st == 200, f"inloggning {email} misslyckades: {svar}"
    cookie = headers.get("set-cookie", "").split(";")[0]
    assert cookie.startswith("grundbok_session="), f"ingen sessionscookie: {headers}"
    return cookie


# Samma exempeltexter som src/lib/exempel.ts (gamla /api/exempel är rivet).
KAFFE_JULI = """FAKTURA
Kafferosteriet Exempel AB
Org.nr 556999-0001

Fakturadatum: 2026-07-08
Fakturanr: 2026-0708

Avser: Kaffebönor, mörkrost 20 kg (livsmedel)

Nettobelopp:        1 000,00 kr
Moms (6 %):        60,00 kr
Att betala:         1 060,00 kr

Betalningsvillkor: 30 dagar
Bankgiro: 999-9999"""

BYGG = """FAKTURA
Underentreprenad Exempel AB
Org.nr 556999-0002

Fakturadatum: 2026-07-01
Fakturanr: UE-2026-114

Avser: Markarbeten etapp 2, byggtjänst enligt avtal

Nettobelopp:        10 000,00 kr
Moms:                    0,00 kr
Att betala:         10 000,00 kr

Omvänd betalningsskyldighet för byggtjänster gäller.
Köparen redovisar momsen (ML 16 kap. 13 §).
Betalningsvillkor: 30 dagar
Bankgiro: 888-8888"""

# ================================================== 1. publika ytan ====

st, html, _ = anropa("GET", "/", rahtml=True)
kontroll("publik sajt svarar med hero + attestkö-mock",
         st == 200 and "Framtidens redovisning" in html and "Att attestera" in html)

st, lead, _ = anropa("POST", "/api/leads",
                     {"namn": "E2E Test", "byra": "Testbyrån AB", "email": "e2e@exempel.se"})
kontroll("leads: kontaktboxen tar emot", st == 200 and lead.get("mottagen") is True, str(lead))
st, lead_fel, _ = anropa("POST", "/api/leads", {"namn": "", "byra": "B", "email": "x"})
kontroll("leads: validering på svenska", st == 400 and "krävs" in str(lead_fel.get("fel", "")), str(lead_fel))

# ============================================ 2. gränser utan session ====

st, _, headers = anropa("GET", "/byra", rahtml=True)
kontroll("/byra utan cookie → redirect till /login",
         st == 307 and "/login" in headers.get("location", ""), f"{st} {headers.get('location')}")
st, _, headers = anropa("GET", "/operator", rahtml=True)
kontroll("/operator utan cookie → redirect till /login",
         st == 307 and "/login" in headers.get("location", ""), f"{st} {headers.get('location')}")

st, svar, _ = anropa("GET", "/api/byra/klienter")
kontroll("api/byra utan session → 401", st == 401, str(svar))
st, svar, _ = anropa("POST", "/api/beslut",
                     {"tenant_id": "kund_a", "proposal_id": "x", "beslut": "godkand"})
kontroll("attest utan session omöjlig → 401", st == 401, str(svar))

for gammal in ("/api/tolka", "/api/forslag", "/api/status", "/api/tenants", "/api/admin/ko"):
    st, _, _ = anropa("GET" if gammal != "/api/tolka" else "POST", gammal, rahtml=True)
    kontroll(f"rivet demo-API {gammal} → 404", st == 404, str(st))

# ================================================ 3. konsultens värld ====

konsult = logga_in("konsult.ett@byran-exempel.se")

st, klienter, _ = anropa("GET", "/api/byra/klienter", cookie=konsult)
kontroll("byrån ser sina klienter (kund_a + kund_b)",
         st == 200 and {k["id"] for k in klienter["klienter"]} == {"kund_a", "kund_b"},
         str(klienter)[:200])
kontroll("sessionen bär byrå och namn",
         klienter.get("byra") == "Byrån Exempel AB"
         and klienter["konsult"]["namn"] == "Konsult Ett Exempel")

# Intag: kaffefakturan (juli) för kund_a
st, tolkning, _ = anropa("POST", "/api/byra/intag/tolka",
                         {"tenant_id": "kund_a", "text": KAFFE_JULI}, cookie=konsult)
kontroll("intag: tolkning (livsmedel, 1 000 kr netto)",
         st == 200 and tolkning["extraktion"]["kategori"] == "livsmedel"
         and tolkning["extraktion"]["netto_ore"] == 100000, str(tolkning)[:200])
motor = tolkning.get("motor")
print(f"      motor: {motor} ({tolkning.get('motor_detalj')})")

st, f_juli, _ = anropa("POST", "/api/byra/intag/forslag", {
    "tenant_id": "kund_a", "document_id": tolkning["document_id"],
    "extraktion": tolkning["extraktion"], "engine": motor,
}, cookie=konsult)
kontroll("förslag juli: 6 % moms, pending under default-policyn",
         st == 200 and f_juli["forslag"]["moms"]["sats"] == 6 and f_juli["status"] == "pending",
         str(f_juli)[:200])
rader = {r["konto"]: (r["debet_ore"], r["kredit_ore"]) for r in f_juli["forslag"]["rader"]}
kontroll("förslag juli: facit 4010/2641/2440",
         rader == {"4010": (100000, 0), "2641": (6000, 0), "2440": (0, 106000)}, str(rader))

# Momsväxlingen — samma underlag, mars-datum → 12 % + avvikelseflagga
st, f_mars, _ = anropa("POST", "/api/byra/intag/forslag", {
    "tenant_id": "kund_a", "document_id": tolkning["document_id"],
    "extraktion": tolkning["extraktion"], "engine": motor,
    "affarshandelsedatum": "2026-03-15",
}, cookie=konsult)
kontroll("momsväxling: mars → 12 % + flaggad avvikelse",
         st == 200 and f_mars["forslag"]["moms"]["sats"] == 12
         and any(fl["id"] == "momssats_avviker" for fl in f_mars["forslag"]["flaggor"]),
         str(f_mars)[:200])

# Attestkön ser båda; attestera juli-förslaget
st, ko, _ = anropa("GET", "/api/byra/ko?klient=kund_a", cookie=konsult)
kontroll("attestkön: förslagen väntar med omräknad policy-diff",
         st == 200 and any(k["id"] == f_juli["proposal_id"] and k["missade_villkor"] for k in ko),
         str(ko)[:200])

st, beslut, _ = anropa("POST", "/api/beslut", {
    "tenant_id": "kund_a", "proposal_id": f_juli["proposal_id"], "beslut": "godkand",
}, cookie=konsult)
kontroll("attest → bokförd V1 med FTX-ref",
         st == 200 and beslut["status"] == "bokford"
         and beslut["verifikation"]["nummer"] == 1
         and str(beslut["verifikation"]["extern_ref"]).startswith("FTX-MOCK-"), str(beslut))

st, dubbel, _ = anropa("POST", "/api/beslut", {
    "tenant_id": "kund_a", "proposal_id": f_juli["proposal_id"], "beslut": "godkand",
}, cookie=konsult)
kontroll("dubbelbeslut nekas", st == 422, str(dubbel))

# Huvudbok + RLS-gränsen mellan klienter
st, hb_a, _ = anropa("GET", "/api/byra/klient/verifikationer?klient=kund_a", cookie=konsult)
kontroll("huvudbok kund_a: 1 balanserad verifikation",
         st == 200 and len(hb_a) == 1
         and sum(int(r["debet_ore"]) for r in hb_a[0]["rader"])
         == sum(int(r["kredit_ore"]) for r in hb_a[0]["rader"]))
st, hb_b, _ = anropa("GET", "/api/byra/klient/verifikationer?klient=kund_b", cookie=konsult)
kontroll("RLS: kund_b ser inte kund_a:s verifikation", hb_b == [])

# Rättelsepost
st, rattelse, _ = anropa("POST", "/api/rattelse",
                         {"tenant_id": "kund_a", "verification_id": hb_a[0]["id"]}, cookie=konsult)
kontroll("rättelsepost V2 skapad", st == 200 and rattelse["nummer"] == 2, str(rattelse))

# Byggflödet för kund_b — omvänd betalningsskyldighet
st, t_bygg, _ = anropa("POST", "/api/byra/intag/tolka",
                       {"tenant_id": "kund_b", "text": BYGG}, cookie=konsult)
st, f_bygg, _ = anropa("POST", "/api/byra/intag/forslag", {
    "tenant_id": "kund_b", "document_id": t_bygg["document_id"],
    "extraktion": t_bygg["extraktion"], "engine": t_bygg["motor"],
}, cookie=konsult)
brader = {r["konto"]: (r["debet_ore"], r["kredit_ore"]) for r in f_bygg["forslag"]["rader"]}
kontroll("bygg: facit 4425/2440/2614/2647 + rutor 24/30/48",
         brader == {"4425": (1000000, 0), "2440": (0, 1000000),
                    "2614": (0, 250000), "2647": (250000, 0)}
         and f_bygg["forslag"]["moms"].get("deklarationsrutor")
         == {"underlag": "24", "utgaende": "30", "ingaende": "48"}, str(brader))

# Chatten — rådgivning med lagrum
st, chatt, _ = anropa("POST", "/api/byra/chatt",
                      {"tenant_id": "kund_a", "fraga": "Vilket konto används för ingående moms?"},
                      cookie=konsult)
kontroll("chatten: svar nämner 2641 med lagrum",
         st == 200 and "2641" in chatt.get("svar", "") and len(chatt.get("lagrum", [])) > 0,
         str(chatt)[:200])

# ================================== 4. byrå-gränsen (URL-manipulation) ====

st, svar, _ = anropa("GET", "/api/byra/ko?klient=annan_byras_kund", cookie=konsult)
kontroll("URL-manipulation: främmande klient i kön → 403", st == 403, str(svar))
st, svar, _ = anropa("GET", "/api/byra/klient/verifikationer?klient=annan_byras_kund",
                     cookie=konsult)
kontroll("URL-manipulation: främmande huvudbok → 403", st == 403, str(svar))
st, svar, _ = anropa("POST", "/api/beslut", {
    "tenant_id": "annan_byras_kund", "proposal_id": f_juli["proposal_id"], "beslut": "godkand",
}, cookie=konsult)
kontroll("URL-manipulation: attest utanför byrån → 403", st == 403, str(svar))

# ================================================ 5. operatörens värld ====

operator = logga_in("leopold@otiva.se")

st, bolag, _ = anropa("GET", "/api/operator/bolag", cookie=operator)
kontroll("operatören ser bolag som AGGREGAT",
         st == 200 and any(b["tenant_id"] == "kund_a" and b["forslag_7d"] >= 1 for b in bolag),
         str(bolag)[:200])
kontroll("aggregatet läcker aldrig innehåll (inga summaries/motparter)",
         "Kaffebönor" not in json.dumps(bolag) and "summary" not in json.dumps(bolag))

st, svar, _ = anropa("GET", "/api/byra/ko?klient=kund_a", cookie=operator)
kontroll("operatören nekas förslags-INNEHÅLL (byråns kö) → 403", st == 403, str(svar))
st, svar, _ = anropa("GET", "/api/operator/bolag", cookie=konsult)
kontroll("konsulten nekas operatörskonsolen → 403", st == 403, str(svar))
st, svar, _ = anropa("GET", "/api/agents?tenant=kund_a", cookie=konsult)
kontroll("konsulten nekas agent-driften → 403", st == 403, str(svar))

# Provisionering med policymall + nyckelrotation som ETT flöde
st, mallar, _ = anropa("GET", "/api/operator/mallar", cookie=operator)
rest = next(m for m in mallar if m["namn"].startswith("Restaurang"))
kontroll("startmallarna seedade", st == 200 and len(mallar) >= 2, str(mallar)[:150])

st, agent, _ = anropa("POST", "/api/agents", {
    "tenant_id": "kund_a", "display_name": "e2e-agent", "mall_id": rest["id"],
}, cookie=operator)
kontroll("provisionering med mall → nyckel EN gång",
         st == 201 and agent.get("nyckel", "").startswith("gk_"), str(agent)[:150])
nyckel = agent["nyckel"]

st, lista, _ = anropa("GET", "/api/agents?tenant=kund_a", cookie=operator)
kontroll("agentlistan läcker aldrig nyckel/hash",
         all(not any(("key" in f or "nyckel" in f or "hash" in f) for f in a) for a in lista),
         str(lista)[:150])

# Agent-porten (nyckel-auth, opåverkad av yt-gatingen)
import hashlib
import uuid as uuidlib


def kanonisk(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, list):
        return "[" + ",".join(kanonisk(x) for x in v) + "]"
    return "{" + ",".join(
        json.dumps(k, ensure_ascii=False) + ":" + kanonisk(v[k]) for k in sorted(v)
    ) + "}"


def bygg_proposal(tenant):
    utan_hash = {
        "contract_version": "0.2.0",
        "id": str(uuidlib.uuid4()),
        "tenant_id": tenant,
        "module": "bokforing",
        "kind": "journal_entry",
        "affarshandelsedatum": "2026-07-08",
        "motpart": "Extern Agent Exempel AB",
        "summary": "Förslag från extern agent (e2e)",
        "lines": [
            {"konto": "4010", "benamning": "Inköp material och varor", "debet_ore": 100000, "kredit_ore": 0},
            {"konto": "2641", "benamning": "Debiterad ingående moms", "debet_ore": 25000, "kredit_ore": 0},
            {"konto": "2440", "benamning": "Leverantörsskulder", "debet_ore": 0, "kredit_ore": 125000},
        ],
        "legal": [{"lagrum": "ML (2023:200) 9 kap.", "ruleset": "se/moms@1.0.0"}],
        "confidence": 0.9,
        "provenance": {
            "model": "claude-opus-4-8",
            "prompt_hash": hashlib.sha256(b"e2e").hexdigest(),
            "module_version": "0.2.0",
            "agent_runtime": "openclaw@0.1-e2e",
            "input_refs": ["mail:e2e-exempel"],
            "injection_screened": True,
        },
    }
    utan_hash["hash"] = hashlib.sha256(kanonisk(utan_hash).encode()).hexdigest()
    return utan_hash


st, svar, _ = anropa("POST", "/api/proposals", bygg_proposal("kund_a"))
kontroll("porten utan nyckel → 401 (opåverkad av yt-auth)", st == 401, str(svar))
agent_forslag = bygg_proposal("kund_a")
st, svar, _ = anropa("POST", "/api/proposals", agent_forslag, nyckel=nyckel)
kontroll("agent-POST med nyckel → 202 pending", st == 202 and svar.get("status") == "pending",
         f"{st} {str(svar)[:150]}")
# Konsulten attesterar agentens förslag — hamnar i loggen med
# agent_runtime, så OpenClaw-körningar kan särskiljas där.
st, svar, _ = anropa("POST", "/api/beslut", {
    "tenant_id": "kund_a", "proposal_id": agent_forslag["id"], "beslut": "godkand",
}, cookie=konsult)
kontroll("konsulten attesterar agentens förslag → bokfört",
         st == 200 and svar.get("status") == "bokford", str(svar)[:150])
st, svar, _ = anropa("POST", "/api/proposals", bygg_proposal("kund_b"), nyckel=nyckel)
kontroll("tenantgräns i porten: kund_a-nyckel mot kund_b → 403", st == 403, str(svar))

# Rotation: nya nyckeln gäller, gamla dör — ETT flöde
st, roterad, _ = anropa("POST", f"/api/agents/{agent['agent_id']}/rotera",
                        {"tenant_id": "kund_a"}, cookie=operator)
kontroll("rotation → ny nyckel, gamla agenten avslutad",
         st == 201 and roterad["nyckel"] != nyckel and roterad["ersatte"] == agent["agent_id"],
         str(roterad)[:150])
st, svar, _ = anropa("POST", "/api/proposals", bygg_proposal("kund_a"), nyckel=nyckel)
kontroll("gamla nyckeln efter rotation → 403", st == 403, str(svar))
# Nya nyckeln släpps in (motparten är nu känd + inom Restaurang-mallen →
# auto_approved 201 är korrekt; poängen här är att porten öppnas igen).
st, svar, _ = anropa("POST", "/api/proposals", bygg_proposal("kund_a"), nyckel=roterad["nyckel"])
kontroll("nya nyckeln efter rotation släpps in i porten", st in (201, 202),
         f"{st} {str(svar)[:120]}")

# Pausning stänger porten med 403 (inte 401)
st, _, _ = anropa("PATCH", f"/api/agents/{roterad['agent_id']}",
                  {"tenant_id": "kund_a", "status": "paused"}, cookie=operator)
st, svar, _ = anropa("POST", "/api/proposals", bygg_proposal("kund_a"), nyckel=roterad["nyckel"])
kontroll("pausad agent → 403 i porten", st == 403, f"{st} {str(svar)[:120]}")

st, halsa, _ = anropa("GET", "/api/operator/halsa", cookie=operator)
kontroll("hälsan svarar med kö-djup", st == 200 and "ko_djup" in halsa, str(halsa))

# ================================= 6. policyöppning → auto-bokföring ====

st, _, _ = anropa("POST", "/api/byra/klient/policy", {
    "tenant_id": "kund_a", "module": "bokforing", "max_belopp_ore": 20000000,
    "min_confidence": 0.5, "kanda_motparter_endast": False,
    "tillatna_kinds": ["journal_entry"],
}, cookie=konsult)
kontroll("byrån öppnar policyn (trösklar i attest-språk)", st == 200)

st, t2, _ = anropa("POST", "/api/byra/intag/tolka",
                   {"tenant_id": "kund_a", "text": KAFFE_JULI}, cookie=konsult)
st, f2, _ = anropa("POST", "/api/byra/intag/forslag", {
    "tenant_id": "kund_a", "document_id": t2["document_id"],
    "extraktion": t2["extraktion"], "engine": t2["motor"],
}, cookie=konsult)
kontroll("öppnad policy: nästa likadana faktura bokförs själv",
         f2.get("status") == "auto_approved" and f2.get("verifikation") is not None,
         str(f2)[:200])

# Beslutsloggen: policy-beslut märkt, attester bär konsultens NAMN
st, logg, _ = anropa("GET", "/api/byra/logg?klient=alla&limit=50", cookie=konsult)
kontroll("loggen: policy-beslutet märkt",
         any(l["policy_beslut"] and l["beslutad_av"] == "autonomipolicyn" for l in logg),
         str(logg)[:200])
kontroll("loggen: attesten bär konsultens namn (verifierad identitet)",
         any(l["outcome"] == "approved" and l["beslutad_av"] == "Konsult Ett Exempel"
             for l in logg), str([l.get("beslutad_av") for l in logg])[:150])
kontroll("loggen: OpenClaw-körningen särskiljd",
         any(l.get("agent_runtime") == "openclaw@0.1-e2e" for l in logg))

# ================================== 7. utloggad mitt i attest ====

tva = logga_in("konsult.tva@byran-exempel.se")
st, _, _ = anropa("POST", "/api/auth/logout", {}, cookie=tva)
kontroll("logout dödar sessionen server-side", st == 200)
st, svar, _ = anropa("POST", "/api/beslut", {
    "tenant_id": "kund_a", "proposal_id": f_juli["proposal_id"], "beslut": "godkand",
}, cookie=tva)
kontroll("utloggad mitt i attest: död cookie → 401", st == 401, str(svar))
st, svar, _ = anropa("GET", "/api/byra/ko?klient=alla", cookie=tva)
kontroll("död cookie i kön → 401", st == 401, str(svar))

# Sammanfattning
ok = sum(1 for _, g, _ in resultat if g)
print(f"\n{ok}/{len(resultat)} kontroller gröna (motor: {motor})")
sys.exit(0 if ok == len(resultat) else 1)
