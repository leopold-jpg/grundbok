import type { PGlite } from "@electric-sql/pglite";

// Kö-interfacet för data plane (WP9, ADR-0003). Lokalt backas det av
// tabellen agent_jobs med pgmq-semantik; i Supabase byts implementationen
// mot pgmq (send/read/archive är medvetet samma vokabulär). Worker-koden
// rör bara interfacet — bytet är en adapter, inte en omskrivning.

export type AgentJobb = {
  job_id: string;
  tenant_id: string;
  agent_id: string;
  module: string;
  trigger: string;
  /** Storage-URI till underlaget (lokalt "document:<uuid>") — aldrig rå data i kön. */
  payload_ref: string;
};

export type KoMeddelande = { msg_id: number; message: AgentJobb; read_ct: number };

export interface Ko {
  send(jobb: AgentJobb): Promise<number>;
  /** Läser upp till qty synliga meddelanden och gör dem osynliga i vtSeconds. */
  read(opts: { qty: number; vtSeconds: number }): Promise<KoMeddelande[]>;
  archive(msgId: number): Promise<void>;
  /** Antal oarkiverade meddelanden (synliga + utcheckade). */
  depth(): Promise<number>;
}

export class PgliteKo implements Ko {
  constructor(private db: PGlite) {}

  async send(jobb: AgentJobb): Promise<number> {
    const r = await this.db.query<{ msg_id: number }>(
      `INSERT INTO agent_jobs (message) VALUES ($1) RETURNING msg_id`,
      [JSON.stringify(jobb)],
    );
    return Number(r.rows[0].msg_id);
  }

  async read(opts: { qty: number; vtSeconds: number }): Promise<KoMeddelande[]> {
    // Samma mönster som pgmq.read: checka ut synliga meddelanden genom
    // att flytta fram visibility-tiden. En krashad worker släpper alltså
    // tillbaka jobbet automatiskt när vt löper ut.
    const r = await this.db.query<{ msg_id: number; message: AgentJobb; read_ct: number }>(
      `UPDATE agent_jobs
       SET vt = now() + make_interval(secs => $1), read_ct = read_ct + 1
       WHERE msg_id IN (
         SELECT msg_id FROM agent_jobs
         WHERE archived_at IS NULL AND vt <= now()
         ORDER BY msg_id
         LIMIT $2
       )
       RETURNING msg_id, message, read_ct`,
      [opts.vtSeconds, opts.qty],
    );
    return r.rows.map((rad) => ({
      msg_id: Number(rad.msg_id),
      message: rad.message,
      read_ct: Number(rad.read_ct),
    }));
  }

  async archive(msgId: number): Promise<void> {
    await this.db.query(
      `UPDATE agent_jobs SET archived_at = now() WHERE msg_id = $1 AND archived_at IS NULL`,
      [msgId],
    );
  }

  async depth(): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_jobs WHERE archived_at IS NULL`,
    );
    return Number(r.rows[0].n);
  }
}
