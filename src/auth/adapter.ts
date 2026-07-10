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

export type Sessionsinfo = {
  user: InloggadUser;
  /** Konsultens byrå (null för rena operatörer). */
  byra: ByraKontext | null;
};

export interface AuthAdapter {
  /** Verifierar e-post + lösenord → sessionstoken (null vid fel). */
  login(email: string, password: string): Promise<{ token: string } | null>;
  logout(token: string): Promise<void>;
  /** Token → sessionsinfo (null om okänd/utgången). */
  session(token: string): Promise<Sessionsinfo | null>;
}
