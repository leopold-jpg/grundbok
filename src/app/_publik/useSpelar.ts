"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

// Hydration-säkert "får animera": false vid SSR och första klient-
// renderingen (servern och klienten renderar samma statiska träd),
// därefter true — men aldrig vid prefers-reduced-motion. Delas av
// kedje-scenen, hero-pixlarna och de illustrerade panelerna; skickas
// som `spelar`-prop till komponenter som inte får läsa hooken själva.
export function useSpelar() {
  const stilla = useReducedMotion();
  const [spelar, setSpelar] = useState(false);
  useEffect(() => {
    if (!stilla) setSpelar(true);
  }, [stilla]);
  return spelar;
}
