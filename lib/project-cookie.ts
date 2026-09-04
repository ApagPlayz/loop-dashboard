/**
 * The cookie the selected project key is mirrored into.
 *
 * This lives in its own dependency-free module, and NOT in
 * `components/project-context.tsx`, for a reason that cost a real bug: that
 * file carries `"use client"`, and when a Server Component imports a value
 * from a client module Next replaces the module with a client-reference
 * proxy. A plain string constant does not survive that — it arrives as
 * `undefined`.
 *
 * Every server page resolved the selected project with
 * `cookieStore.get(PROJECT_COOKIE)`, which was therefore
 * `cookieStore.get(undefined)` → no match → silent fall back to the first
 * registered project. Switching projects updated the sidebar (client side,
 * where the import worked) while every page kept rendering the first
 * project's data. Nothing threw; it just quietly showed the wrong repo.
 *
 * Keep this module free of imports and of `"use client"` so both sides can
 * share the one literal.
 */
export const PROJECT_COOKIE = "loop_project";
