/**
 * The complete list of `/api/*` responses an anonymous visitor can obtain.
 *
 * This is the anonymous allowlist. The proxy looks a request up here and, on a
 * hit, serialises the fixture body itself; on a miss it returns 403. A route
 * with no entry is unreachable without a session — including every route added
 * to `app/api/**` in the future, which is the point. Exposing something new is
 * an explicit act: you write a fixture for it.
 *
 * Everything here is invented. See lib/demo/world.ts for why real data was
 * rejected even though a curated corpus was sitting in the repo.
 */

import { fixtureMatches, type DemoFixture } from "@/lib/demo/types";
import { MAP_FIXTURES } from "@/lib/demo/fixtures-map";
import { QUEUE_FIXTURES } from "@/lib/demo/fixtures-queues";
import { TOOLS_FIXTURES } from "@/lib/demo/fixtures-tools";

export const DEMO_FIXTURES: DemoFixture[] = [
  ...MAP_FIXTURES,
  ...QUEUE_FIXTURES,
  ...TOOLS_FIXTURES,
];

/** The fixture that answers this request, or null — which the proxy turns into a 403. */
export function findDemoFixture(
  pathname: string,
  method: string,
): DemoFixture | null {
  return (
    DEMO_FIXTURES.find((fixture) => fixtureMatches(fixture, pathname, method)) ??
    null
  );
}

/**
 * Every API path an anonymous visitor may read, for the guard test in
 * tests/lib/public-access.test.ts. Exact-string matches only — the
 * parameterised ones are RegExps and are asserted separately.
 */
export function demoFixtureLiteralPaths(): string[] {
  return DEMO_FIXTURES.filter((f) => typeof f.match === "string").map(
    (f) => f.match as string,
  );
}
