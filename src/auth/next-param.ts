// Vitlistning av login-flödets ?next=-parameter (Bugbot PR #2: open
// redirect). En svartlista räcker inte: WHATWG-parsern (som Nexts router
// använder) strippar kontrolltecken, så "/\t//evil.com" blev "//evil.com"
// efter parsning trots att strängen varken börjar på "//" eller
// innehåller backslash. Därför valideras värdet genom SAMMA parser:
// upplöst mot en intern bas måste origin förbli den interna — annars
// följs inte parametern. Det som returneras är den NORMALISERADE pathen
// (pathname + search + hash), aldrig råsträngen.

const INTERN_BAS = "https://intern.invalid";

export function sakerNext(next: string | null): string | null {
  if (!next || !next.startsWith("/")) return null;
  try {
    const url = new URL(next, INTERN_BAS);
    if (url.origin !== INTERN_BAS) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
