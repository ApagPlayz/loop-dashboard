/**
 * The contract every demo fixture file implements.
 *
 * A fixture is not "a mock" — it is the ONLY thing an anonymous visitor can get
 * back from `/api/*`. The proxy matches the request against this list and, on a
 * hit, serialises `body(url)` and returns it without the route handler ever
 * being invoked. A miss is a 403. So this list doubles as the anonymous
 * allowlist: to expose a route publicly you add a fixture for it, and there is
 * no way to expose one by accident.
 */

export type DemoFixture = {
  /**
   * Exact pathname, or a RegExp for a parameterised route. A RegExp MUST be
   * anchored (`^…$`) — an unanchored pattern would match longer paths and could
   * hand a fixture to a route it was not written for.
   */
  match: string | RegExp;
  /** Methods this fixture answers. Anything else falls through to a 403. */
  methods?: readonly string[];
  /** Builds the JSON body. `url` gives access to `?project=` and friends. */
  body: (url: URL) => unknown;
};

/** True when `fixture` should answer this request. */
export function fixtureMatches(
  fixture: DemoFixture,
  pathname: string,
  method: string,
): boolean {
  const methods = fixture.methods ?? ["GET"];
  if (!methods.includes(method.toUpperCase())) return false;
  return typeof fixture.match === "string"
    ? fixture.match === pathname
    : fixture.match.test(pathname);
}
