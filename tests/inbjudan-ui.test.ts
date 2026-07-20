import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { createDb } from "../src/lib/db/client";
import { skapaKlientInbjudan } from "../src/auth/klient-inbjudan";

// UI-test för klientinbjudan (WP20). API:t hade redan tester — det som
// saknades var täckning av det kunden faktiskt möter: sidan renderas,
// effekten kontrollerar länken, formuläret fylls i, inlösen sker EN
// gång och webbläsaren skickas in i /app. Regressionen som motiverar
// testet: när kontrollsvaret inte gick att tolka fastnade sidan tyst på
// "kontrollerar inbjudan …" för alltid.
//
// Riggen är äkta hela vägen ned: den riktiga komponenten renderas i
// jsdom, dess fetch går in i de riktiga route-handlarna, som i sin tur
// går mot en riktig (in-memory) PGlite. Bara CSS/font/navigation är
// stubbade — se inbjudan-ui-stubbar.mjs.

process.env.GRUNDBOK_FORCE_FALLBACK = "1";

const db = await createDb();
// Route-handlarnas getDb() är en singleton på globalThis — vi planterar
// testdatabasen där så att handlarna kör mot den och inte mot .data/.
(globalThis as { __grundbokDb?: Promise<unknown> }).__grundbokDb = Promise.resolve(db);

// page.tsx är en klientkomponent som drar in tre saker Node inte kan
// ladda utan Next: CSS-importen, next/font (kräver byggsteget) och
// next/navigation (kräver app-routerns context). Exakt de tre byts ut —
// allt annat i komponenten körs som det gör i webbläsaren.
const stubbar: Record<string, string> = {
  "next/navigation": `export function useSearchParams() {
     return new URLSearchParams(globalThis.__inbjudanSok ?? "");
   }`,
  "_publik/fonter": `export const plexMono = { variable: "font-plex-mono" };`,
  ".css": `export default {};`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const [nyckel, kod] of Object.entries(stubbar)) {
      if (specifier === nyckel || specifier.endsWith(nyckel)) {
        return {
          url: "data:text/javascript," + encodeURIComponent(kod),
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/app/inbjudan",
  pretendToBeVisual: true,
});
const glob = globalThis as unknown as Record<string, unknown>;
glob.window = dom.window;
glob.document = dom.window.document;
glob.IS_REACT_ACT_ENVIRONMENT = true;
for (const namn of ["HTMLElement", "HTMLInputElement", "Event", "Node", "MutationObserver"]) {
  glob[namn] = (dom.window as unknown as Record<string, unknown>)[namn];
}
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

// Modulerna laddas FÖRST här — efter register() och jsdom-riggen.
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { InbjudanForm } = await import("../src/app/app/inbjudan/page");
const route = await import("../src/app/api/app/inbjudan/route");
const { act } = React;

type Anrop = { metod: string; sokvag: string };

/** Sidans fetch → de riktiga route-handlarna. Returnerar loggen så att
 *  testet kan räkna anropen (inlösen ska ske exakt en gång). */
function riktigFetch(anrop: Anrop[]) {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const metod = (init.method ?? "GET").toUpperCase();
    anrop.push({ metod, sokvag: url.pathname + url.search });
    const req = new Request(url, init);
    return metod === "POST" ? route.POST(req) : route.GET(req);
  };
}

async function montera(opts: {
  token: string;
  fetchImpl: typeof fetch;
  navigerade: string[];
}) {
  glob.__inbjudanSok = `token=${encodeURIComponent(opts.token)}`;
  glob.fetch = opts.fetchImpl;
  const behallare = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(behallare);
  const root = createRoot(behallare);
  await act(async () => {
    root.render(
      React.createElement(InbjudanForm, { navigera: (url: string) => opts.navigerade.push(url) }),
    );
  });
  return {
    text: () => behallare.textContent ?? "",
    finn: <T extends Element>(sel: string) => behallare.querySelector<T>(sel),
    knappMedText: (t: string) =>
      [...behallare.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(t)),
  };
}

/** Skriv i ett React-styrt fält: värdet måste sättas via prototypens
 *  setter för att React ska se ändringen. */
async function skriv(el: HTMLInputElement, varde: string) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, varde);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("hela UI-flödet: giltig länk → formulär → inlösen EN gång → in i /app", async () => {
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "ui.kund@example.com",
    skapadAv: "konsult:test",
  });

  const anrop: Anrop[] = [];
  const navigerade: string[] = [];
  const vy = await montera({ token: inbjudan.token, fetchImpl: riktigFetch(anrop), navigerade });

  // Kontrollen ska ha landat — inte fastnat på "kontrollerar inbjudan".
  assert.match(vy.text(), /Välkommen till/);
  assert.match(vy.text(), /ui\.kund@example\.com/);
  assert.equal(anrop.filter((a) => a.metod === "GET").length, 1);

  const [namn, losenord] = [...(vy.finn("form")!.querySelectorAll("input") as never)] as [
    HTMLInputElement,
    HTMLInputElement,
  ];
  const knapp = vy.knappMedText("Skapa konto")!;
  assert.equal(knapp.disabled, true, "knappen är låst innan fälten är ifyllda");

  await skriv(namn, "UI Kund");
  await skriv(losenord, "klientlosen-1");
  assert.equal(knapp.disabled, false);

  // Två submits i rad (dubbelklick) får aldrig ge två inlösen.
  await act(async () => {
    vy.finn("form")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    vy.finn("form")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  assert.equal(
    anrop.filter((a) => a.metod === "POST").length,
    1,
    "engångstoken löses in exakt en gång",
  );
  assert.deepEqual(navigerade, ["/app"], "webbläsaren skickas in i appen");

  // Klientsessionen finns på riktigt: användare, membership och session.
  const user = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    "ui.kund@example.com",
  ]);
  assert.equal(user.rows.length, 1);
  const medlemskap = await db.query<{ role: string; tenant_id: string }>(
    `SELECT role, tenant_id FROM memberships WHERE user_id = $1`,
    [user.rows[0].id],
  );
  assert.equal(medlemskap.rows[0].role, "klient");
  assert.equal(medlemskap.rows[0].tenant_id, "kund_a");
  const sessioner = await db.query(
    `SELECT 1 FROM sessions WHERE user_id = $1 AND expires_at > now()`,
    [user.rows[0].id],
  );
  assert.equal(sessioner.rows.length, 1);

  // Länken är död efteråt — samma sida visar det, den hänger inte.
  const vy2 = await montera({
    token: inbjudan.token,
    fetchImpl: riktigFetch([]),
    navigerade: [],
  });
  assert.match(vy2.text(), /Inbjudan gäller inte längre/);
});

test("otolkbart kontrollsvar fastnar aldrig på 'kontrollerar inbjudan'", async () => {
  const inbjudan = await skapaKlientInbjudan(db, {
    tenantId: "kund_a",
    email: "ui.avbrott@example.com",
    skapadAv: "konsult:test",
  });

  const anrop: Anrop[] = [];
  const akta = riktigFetch(anrop);
  let trasig = true;
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (trasig) {
      // Precis det svar som fällde flödet: HTML där JSON förväntades.
      trasig = false;
      return new Response("<!doctype html><html>proxy</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return akta(input, init);
  }) as typeof fetch;

  const navigerade: string[] = [];
  const vy = await montera({ token: inbjudan.token, fetchImpl, navigerade });

  assert.doesNotMatch(vy.text(), /kontrollerar inbjudan/);
  assert.match(vy.text(), /Kunde inte kontrollera inbjudan/);

  // …och det går att ta sig vidare utan att ladda om länken.
  await act(async () => {
    vy.knappMedText("Försök igen")!.dispatchEvent(
      new dom.window.Event("click", { bubbles: true }),
    );
  });
  assert.match(vy.text(), /Välkommen till/);
});
