// Auth-interfacet (WP11): samma adaptermönster som Ko-interfacet — lokalt
// backas det av PGlite-sessioner (pglite-auth.ts); vid deploy byts
// implementationen mot Supabase Auth utan att ytorna rörs.

export type InloggadUser = {
  id: string;
  email: string;
  name: string;
  is_operator: boolean;
};

export type ByraKontext = {
  id: string;
  namn: string;
  role: "konsult";
};

/** Klientanvändarens värld (WP20): EN tenant — aldrig byrå-kontext,
 *  aldrig andra bolag. */
export type KlientKontext = {
  tenant_id: string;
  tenant_namn: string;
};

export type Sessionsinfo = {
  user: InloggadUser;
  /** Konsultens byrå (null för rena operatörer och klienter). */
  byra: ByraKontext | null;
  /** Klientanvändarens bolag (null för konsulter och operatörer). */
  klient: KlientKontext | null;
};

export interface AuthAdapter {
  /** Verifierar e-post + lösenord → sessionstoken (null vid fel). */
  login(email: string, password: string): Promise<{ token: string } | null>;
  logout(token: string): Promise<void>;
  /** Token → sessionsinfo (null om okänd/utgången). */
  session(token: string): Promise<Sessionsinfo | null>;
}
