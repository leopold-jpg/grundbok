// Next.js instrumentation-hook — körs en gång per serverstart, före
// första requesten. Registrerar Langfuse-tracingen (no-op utan nycklar,
// se src/lib/observability/langfuse.ts). Edge-runtimen (middleware) rör
// aldrig OTel-providern — guarden nedan är hård.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initLangfuse } = await import("@/lib/observability/langfuse");
    await initLangfuse();
  }
}
