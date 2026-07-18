// Statuspunkt (WP27/WP28) — agentstatus som punkt + svensk etikett,
// delad av båda ytorna. Färg är STATUS, aldrig dekor (kanon §2):
// aktiv = statusgrönt, pausad = varning (driften ska se den), avslutad
// = neutral. Texten bär alltid betydelsen — punkten är förstärkning.

export type AgentStatus = "active" | "paused" | "canceled";

const TEXT: Record<AgentStatus, string> = {
  active: "aktiv",
  paused: "pausad",
  canceled: "avslutad",
};

export function StatusPunkt({ status }: { status: AgentStatus }) {
  return (
    <span className={`statuspunkt statuspunkt-${status}`}>
      <span className="punkt" aria-hidden="true" />
      {TEXT[status]}
    </span>
  );
}
