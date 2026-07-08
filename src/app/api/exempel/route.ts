import { NextResponse } from "next/server";
import { EXEMPEL } from "@/lib/exempel";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(EXEMPEL);
}
