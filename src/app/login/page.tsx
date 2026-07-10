"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sakerNext } from "@/auth/next-param";
import { fraunces, plexMono } from "../_publik/fonter";
import "./login.css";

// Inloggning för byrå-konsulter och operatören (WP11). Lokal dev-auth —
// Supabase Auth tar över bakom samma AuthAdapter vid deploy (S4).
// Utseendet delar publika sajtens formspråk (design-sajt); logiken är
// oförändrad.

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
    <main className={`login-sida ${fraunces.variable} ${plexMono.variable}`}>
      <div className="wordmark">
        <a href="/">
          grund<em>bok</em>
        </a>
      </div>
      <section className="dokument">
        <h1>Logga in</h1>
        <form onSubmit={loggaIn}>
          <label>
            <span className="falt-etikett">E-post</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            <span className="falt-etikett">Lösenord</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="login-knapp" type="submit" disabled={loggarIn || !email || !password}>
            {loggarIn ? "Loggar in …" : "Logga in"}
          </button>
          {fel && <p className="fel">{fel}</p>}
        </form>
        <p className="tyst dev-not">
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
