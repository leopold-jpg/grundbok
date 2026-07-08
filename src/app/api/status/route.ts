import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const harNyckel = Boolean(process.env.ANTHROPIC_API_KEY);
  const tvingad = process.env.GRUNDBOK_FORCE_FALLBACK === "1";
  return NextResponse.json({
    motor: harNyckel && !tvingad ? "anthropic" : "fallback",
    modell: process.env.GRUNDBOK_MODEL ?? "claude-opus-4-8",
    detalj: tvingad
      ? "GRUNDBOK_FORCE_FALLBACK=1"
      : harNyckel
        ? "ANTHROPIC_API_KEY satt"
        : "ingen ANTHROPIC_API_KEY",
  });
}
