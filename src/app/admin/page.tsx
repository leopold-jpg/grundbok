import { redirect } from "next/navigation";

// v0-admin är riven (WP14): kön och loggen bor i /byra, driften i
// /operator. Gamla bokmärken landar hos operatören.
export default function AdminRedirect() {
  redirect("/operator");
}
