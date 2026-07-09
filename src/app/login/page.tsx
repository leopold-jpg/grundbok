"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sakerNext } from "@/auth/next-param";

// Inloggning för byrå-konsulter och operatören (WP11). Lokal dev-auth —
// Supabase Auth tar över bakom samma AuthAdapter vid deploy (S4).

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fel, setFel] = useState("");
  const [loggarIn, setLoggarIn] = useState(false);

  async function loggaIn(e: React.FormEvent) {
    e.preventDefault();
    setFel("");
    setLoggarIn(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.fel ?? `HTTP ${r.status}`);
      // Endast interna paths följs (open redirect, Bugbot PR #2).
      const next = sakerNext(params.get("next"));
      router.push(next ?? (data.operator ? "/operator" : "/byra"));
    } catch (err) {
      setFel(err instanceof Error ? err.message : String(err));
      setLoggarIn(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, marginTop: "10vh" }}>
      <div className="wordmark" style={{ marginBottom: "var(--sp-6)" }}>
        grund<em>bok</em>
      </div>
      <section className="steg">
        <div className="steg-rubrik">
          <span className="steg-titel">Logga in</span>
        </div>
        <form onSubmit={loggaIn} style={{ display: "grid", gap: "var(--sp-3)" }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-post"
            autoComplete="username"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Lösenord"
            autoComplete="current-password"
          />
          <button className="primar" type="submit" disabled={loggarIn || !email || !password}>
            {loggarIn ? "Loggar in …" : "Logga in"}
          </button>
          {fel && <p className="fel">{fel}</p>}
        </form>
        <p className="tyst" style={{ marginTop: "var(--sp-4)" }}>
          Dev-läge: konsult.ett@byran-exempel.se eller leopold@otiva.se,
          lösenord <code>grundbok-dev</code>. Riktig inloggning (Supabase Auth)
          kopplas in vid deploy.
        </p>
      </section>
    </main>
  );
}

export default function LoginSida() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
