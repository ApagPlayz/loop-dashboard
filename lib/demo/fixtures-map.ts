/**
 * Demo fixtures for the Process Map section (`/api/map/**` and
 * `/api/launch/status`).
 *
 * ## Real, and computed by the real code where it can be
 *
 * Every run id, commit sha, diff, workflow state and file body below was read
 * from the owner's two public repos on 4 September 2026 — see
 * lib/demo/world.ts for why the snapshot is frozen rather than fetched.
 *
 * Two things are deliberately NOT hard-coded here:
 *
 *   - The agent drawer's prompt and capability lists are produced by calling
 *     the SAME `extractPrompt()` and `parseCapabilities()` the live route
 *     calls, over the verbatim workflow YAML in
 *     `lib/demo/fixtures-workflows.ts`. So the instructions a visitor reads in
 *     the drawer are the instructions the agent is actually given, and they
 *     cannot drift from the extractor.
 *   - The template-drift screen calls the real `unifiedDiff()` over the real
 *     template and the real installed workflows. The drift it shows is the
 *     drift that exists.
 *
 * The two projects genuinely differ, which is why the map is worth looking at:
 * content-generation-platform has all ten workflows ACTIVE and the Scout and
 * Builder running on schedule; supply-chain-optimizer has eight of them
 * `disabled_manually` because the owner switched that loop off on purpose
 * while repairing it. The paused state is real, not a styling demo.
 */

import type { DemoFixture } from "@/lib/demo/types";
import {
  DEMO_DEFAULT_PROJECT,
  DEMO_OWNER,
  DEMO_PROJECTS,
  demoRepoUrl,
} from "@/lib/demo/world";
import {
  DEMO_REPO_WORKFLOWS,
  DEMO_SECOND_REPO_WORKFLOWS,
  DEMO_REPO_MCP_JSON,
  DEMO_TEMPLATE_WORKFLOWS,
  DEMO_TEMPLATE_FILES,
} from "@/lib/demo/fixtures-workflows";
import { AGENTS } from "@/lib/map-agents";
import { extractPrompt } from "@/lib/map-yaml";
import { parseCapabilities } from "@/lib/map-capabilities";
import {
  templateContentHash,
  unifiedDiff,
  TEMPLATE_FILE_TARGETS,
} from "@/lib/loop-template";
import type {
  AgentDetail,
  AgentMeta,
  AgentStatus,
  Capabilities,
  HistoryCommit,
  MapStatus,
  RunSummary,
} from "@/lib/map-types";

const SECOND_PROJECT = DEMO_PROJECTS[1]!; // supply-chain-optimizer — the paused one

/* ------------------------------------------------------------------ */
/* Real run history, per agent, per project                            */
/* ------------------------------------------------------------------ */

type RawRun = Omit<RunSummary, "id"> & { id: number };

/** `gh run list --workflow <file> --limit 5` on content-generation-platform. */
const DEFAULT_RUNS: Record<string, RawRun[]> = {
  scout: [
    {
      id: 33900734875,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T17:28:08Z",
      updatedAt: "2026-09-04T17:28:23Z",
      durationSec: 15,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33900734875",
    },
    {
      id: 33877319005,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T13:18:21Z",
      updatedAt: "2026-09-04T13:18:35Z",
      durationSec: 14,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33877319005",
    },
    {
      id: 33854559992,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T08:40:21Z",
      updatedAt: "2026-09-04T08:40:36Z",
      durationSec: 15,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33854559992",
    },
    {
      id: 33834291216,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T03:44:17Z",
      updatedAt: "2026-09-04T03:44:28Z",
      durationSec: 11,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33834291216",
    },
    {
      id: 33816043859,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-03T23:05:26Z",
      updatedAt: "2026-09-03T23:05:41Z",
      durationSec: 15,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33816043859",
    },
  ],
  redraft: [
    {
      id: 32864760736,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-25T15:16:26Z",
      updatedAt: "2026-08-25T15:16:27Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32864760736",
    },
    {
      id: 30770188465,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-02T22:28:53Z",
      updatedAt: "2026-08-02T22:28:54Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30770188465",
    },
    {
      id: 30384700338,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-07-28T17:50:16Z",
      updatedAt: "2026-07-28T17:50:18Z",
      durationSec: 2,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30384700338",
    },
    {
      id: 30381870468,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-07-28T17:12:54Z",
      updatedAt: "2026-07-28T17:12:55Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30381870468",
    },
    {
      id: 30302445228,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-07-27T20:24:29Z",
      updatedAt: "2026-07-27T20:24:30Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30302445228",
    },
  ],
  builder: [
    {
      id: 33912732448,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T19:44:48Z",
      updatedAt: "2026-09-04T19:46:02Z",
      durationSec: 74,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33912732448",
    },
    {
      id: 33899958637,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T17:19:31Z",
      updatedAt: "2026-09-04T17:20:28Z",
      durationSec: 57,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33899958637",
    },
    {
      id: 33880731192,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T13:55:08Z",
      updatedAt: "2026-09-04T13:56:34Z",
      durationSec: 86,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33880731192",
    },
    {
      id: 33860117324,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T09:47:59Z",
      updatedAt: "2026-09-04T09:49:04Z",
      durationSec: 65,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33860117324",
    },
    {
      id: 33840078731,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T05:19:43Z",
      updatedAt: "2026-09-04T05:20:50Z",
      durationSec: 67,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33840078731",
    },
  ],
  audit: [
    {
      id: 33344051344,
      status: "completed",
      conclusion: "action_required",
      createdAt: "2026-08-31T00:15:42Z",
      updatedAt: "2026-08-31T00:15:42Z",
      durationSec: 0,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344051344",
    },
    {
      id: 32868858539,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-25T15:56:08Z",
      updatedAt: "2026-08-25T16:10:24Z",
      durationSec: 856,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32868858539",
    },
    {
      id: 30771334603,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T23:00:34Z",
      updatedAt: "2026-09-01T23:01:43Z",
      durationSec: 2592069,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30771334603",
    },
    {
      id: 30771294924,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-02T22:59:33Z",
      updatedAt: "2026-08-02T23:11:56Z",
      durationSec: 743,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30771294924",
    },
    {
      id: 30770881376,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-02T22:47:41Z",
      updatedAt: "2026-08-02T23:04:29Z",
      durationSec: 1008,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30770881376",
    },
  ],
  demo: [
    {
      id: 33344051380,
      status: "completed",
      conclusion: "action_required",
      createdAt: "2026-08-31T00:15:42Z",
      updatedAt: "2026-08-31T00:15:42Z",
      durationSec: 0,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344051380",
    },
    {
      id: 32868858545,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-25T15:56:08Z",
      updatedAt: "2026-08-25T16:04:17Z",
      durationSec: 489,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32868858545",
    },
    {
      id: 30771334608,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T23:00:34Z",
      updatedAt: "2026-09-01T23:01:43Z",
      durationSec: 2592069,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30771334608",
    },
    {
      id: 30771294921,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-02T22:59:33Z",
      updatedAt: "2026-08-02T23:08:50Z",
      durationSec: 557,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30771294921",
    },
    {
      id: 30770881364,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-02T22:47:41Z",
      updatedAt: "2026-08-02T23:00:16Z",
      durationSec: 755,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30770881364",
    },
  ],
  retro: [
    {
      id: 33343636364,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-31T00:07:42Z",
      updatedAt: "2026-08-31T00:17:02Z",
      durationSec: 560,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33343636364",
    },
    {
      id: 32669995586,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-23T22:14:44Z",
      updatedAt: "2026-08-23T22:14:58Z",
      durationSec: 14,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32669995586",
    },
    {
      id: 31975766951,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-16T22:13:46Z",
      updatedAt: "2026-08-16T22:13:57Z",
      durationSec: 11,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/31975766951",
    },
    {
      id: 31339246234,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-09T22:22:55Z",
      updatedAt: "2026-08-09T22:28:38Z",
      durationSec: 343,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/31339246234",
    },
    {
      id: 30770952185,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-02T22:49:41Z",
      updatedAt: "2026-08-02T23:00:50Z",
      durationSec: 669,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30770952185",
    },
  ],
  metrics: [
    {
      id: 33885201689,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-04T14:41:35Z",
      updatedAt: "2026-09-04T14:41:58Z",
      durationSec: 23,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33885201689",
    },
    {
      id: 33769163187,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-03T14:49:56Z",
      updatedAt: "2026-09-03T14:50:20Z",
      durationSec: 24,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33769163187",
    },
    {
      id: 33644945788,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-02T14:53:03Z",
      updatedAt: "2026-09-02T14:53:22Z",
      durationSec: 19,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33644945788",
    },
    {
      id: 33525243994,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-09-01T15:21:34Z",
      updatedAt: "2026-09-01T15:21:56Z",
      durationSec: 22,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33525243994",
    },
    {
      id: 33421430099,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-31T17:46:58Z",
      updatedAt: "2026-08-31T17:47:23Z",
      durationSec: 25,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33421430099",
    },
  ],
  mention: [
    {
      id: 33344097672,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-31T00:16:35Z",
      updatedAt: "2026-08-31T00:16:36Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344097672",
    },
    {
      id: 33344080334,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-31T00:16:14Z",
      updatedAt: "2026-08-31T00:16:16Z",
      durationSec: 2,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344080334",
    },
    {
      id: 32870319671,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-25T16:10:13Z",
      updatedAt: "2026-08-25T16:10:19Z",
      durationSec: 6,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32870319671",
    },
    {
      id: 32869682614,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-25T16:04:01Z",
      updatedAt: "2026-08-25T16:04:02Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32869682614",
    },
    {
      id: 32867341546,
      status: "completed",
      conclusion: "skipped",
      createdAt: "2026-08-25T15:41:17Z",
      updatedAt: "2026-08-25T15:41:18Z",
      durationSec: 1,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32867341546",
    },
  ],
  toolinstall: [
    {
      id: 29616269119,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-17T21:55:28Z",
      updatedAt: "2026-07-17T22:13:04Z",
      durationSec: 1056,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/29616269119",
    },
    {
      id: 29616253072,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-17T21:55:07Z",
      updatedAt: "2026-07-17T22:09:26Z",
      durationSec: 859,
      url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/29616253072",
    },
  ],
};

/** The same, on supply-chain-optimizer — mostly empty, because it is paused. */
const SECOND_RUNS: Record<string, RawRun[]> = {
  scout: [
    {
      id: 30768545689,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T21:44:12Z",
      updatedAt: "2026-08-02T21:44:38Z",
      durationSec: 26,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30768545689",
    },
    {
      id: 30764829049,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T20:05:21Z",
      updatedAt: "2026-08-02T20:05:50Z",
      durationSec: 29,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30764829049",
    },
    {
      id: 30762182760,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T18:54:37Z",
      updatedAt: "2026-08-02T18:55:02Z",
      durationSec: 25,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30762182760",
    },
    {
      id: 30759854021,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T17:52:56Z",
      updatedAt: "2026-08-02T17:53:27Z",
      durationSec: 31,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30759854021",
    },
    {
      id: 30757375307,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-08-02T16:46:05Z",
      updatedAt: "2026-08-02T16:46:36Z",
      durationSec: 31,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30757375307",
    },
  ],
  redraft: [],
  builder: [
    {
      id: 32122206083,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-18T09:33:16Z",
      updatedAt: "2026-08-18T09:33:26Z",
      durationSec: 10,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32122206083",
    },
    {
      id: 32117249611,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-18T08:36:34Z",
      updatedAt: "2026-08-18T08:36:46Z",
      durationSec: 12,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32117249611",
    },
    {
      id: 32112345921,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-18T07:37:47Z",
      updatedAt: "2026-08-18T07:37:56Z",
      durationSec: 9,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32112345921",
    },
    {
      id: 32108884307,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-18T06:53:28Z",
      updatedAt: "2026-08-18T06:53:40Z",
      durationSec: 12,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32108884307",
    },
    {
      id: 32104880242,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-18T05:57:05Z",
      updatedAt: "2026-08-18T05:57:17Z",
      durationSec: 12,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32104880242",
    },
  ],
  audit: [
    {
      id: 29350154438,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-14T16:33:43Z",
      updatedAt: "2026-07-14T16:33:55Z",
      durationSec: 12,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/29350154438",
    },
    {
      id: 29338778289,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-14T13:58:32Z",
      updatedAt: "2026-07-14T13:58:50Z",
      durationSec: 18,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/29338778289",
    },
    {
      id: 29338396159,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-14T13:53:17Z",
      updatedAt: "2026-07-14T13:53:31Z",
      durationSec: 14,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/29338396159",
    },
  ],
  demo: [],
  retro: [
    {
      id: 31975932876,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-16T22:17:20Z",
      updatedAt: "2026-08-16T22:17:32Z",
      durationSec: 12,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31975932876",
    },
    {
      id: 31339407673,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-09T22:26:46Z",
      updatedAt: "2026-08-09T22:26:55Z",
      durationSec: 9,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31339407673",
    },
    {
      id: 30771080108,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-02T22:53:14Z",
      updatedAt: "2026-08-02T22:53:27Z",
      durationSec: 13,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30771080108",
    },
    {
      id: 30224164511,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-07-26T22:56:48Z",
      updatedAt: "2026-07-26T22:57:14Z",
      durationSec: 26,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30224164511",
    },
    {
      id: 29706808987,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-07-19T22:48:22Z",
      updatedAt: "2026-07-19T22:48:51Z",
      durationSec: 29,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/29706808987",
    },
  ],
  metrics: [
    {
      id: 32024428316,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-17T11:20:02Z",
      updatedAt: "2026-08-17T11:20:18Z",
      durationSec: 16,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32024428316",
    },
    {
      id: 31943801223,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-16T11:14:38Z",
      updatedAt: "2026-08-16T11:14:54Z",
      durationSec: 16,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31943801223",
    },
    {
      id: 31881571749,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-15T11:15:05Z",
      updatedAt: "2026-08-15T11:15:23Z",
      durationSec: 18,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31881571749",
    },
    {
      id: 31797157528,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-14T11:40:20Z",
      updatedAt: "2026-08-14T11:40:38Z",
      durationSec: 18,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31797157528",
    },
    {
      id: 31696630601,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-13T11:41:37Z",
      updatedAt: "2026-08-13T11:41:50Z",
      durationSec: 13,
      url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31696630601",
    },
  ],
  mention: [],
  toolinstall: [],
};

/** Latest run + real on/off state, from `gh workflow list --all`. */
type Badge = {
  enabled: boolean;
  status: string | null;
  conclusion: string | null;
  createdAt: string | null;
  url: string | null;
};

const DEFAULT_BADGES: Record<string, Badge> = {
  scout: {
    enabled: true,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T17:28:08Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33900734875",
  },
  redraft: {
    enabled: true,
    status: "completed",
    conclusion: "skipped",
    createdAt: "2026-08-25T15:16:26Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32864760736",
  },
  builder: {
    enabled: true,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T19:44:48Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33912732448",
  },
  audit: {
    enabled: true,
    status: "completed",
    conclusion: "action_required",
    createdAt: "2026-08-31T00:15:42Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344051344",
  },
  demo: {
    enabled: true,
    status: "completed",
    conclusion: "action_required",
    createdAt: "2026-08-31T00:15:42Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344051380",
  },
  retro: {
    enabled: true,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-31T00:07:42Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33343636364",
  },
  metrics: {
    enabled: true,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T14:41:35Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33885201689",
  },
  mention: {
    enabled: true,
    status: "completed",
    conclusion: "skipped",
    createdAt: "2026-08-31T00:16:35Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344097672",
  },
  toolinstall: {
    enabled: true,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-17T21:55:28Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/29616269119",
  },
};

const SECOND_BADGES: Record<string, Badge> = {
  scout: {
    enabled: false,
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-08-02T21:44:12Z",
    url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/30768545689",
  },
  redraft: {
    enabled: false,
    status: null,
    conclusion: null,
    createdAt: null,
    url: null,
  },
  builder: {
    enabled: false,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-18T09:33:16Z",
    url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32122206083",
  },
  audit: {
    enabled: false,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-14T16:33:43Z",
    url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/29350154438",
  },
  demo: {
    enabled: false,
    status: null,
    conclusion: null,
    createdAt: null,
    url: null,
  },
  retro: {
    enabled: false,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-16T22:17:20Z",
    url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/31975932876",
  },
  metrics: {
    enabled: false,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-17T11:20:02Z",
    url: "https://github.com/ApagPlayz/supply-chain-optimizer/actions/runs/32024428316",
  },
  mention: {
    enabled: true,
    status: null,
    conclusion: null,
    createdAt: null,
    url: null,
  },
  toolinstall: {
    enabled: false,
    status: null,
    conclusion: null,
    createdAt: null,
    url: null,
  },
};

function agentStatuses(badges: Record<string, Badge>): AgentStatus[] {
  return AGENTS.map((meta) => {
    const b = badges[meta.id] ?? {
      enabled: true,
      status: null,
      conclusion: null,
      createdAt: null,
      url: null,
    };
    return {
      id: meta.id,
      file: meta.file,
      label: meta.label,
      tagline: meta.tagline,
      generic: false,
      ...b,
    };
  });
}

/* ------------------------------------------------------------------ */
/* /api/map/projects                                                   */
/* ------------------------------------------------------------------ */

const PROJECTS_FIXTURE: DemoFixture = {
  match: "/api/map/projects",
  body: () => ({ projects: DEMO_PROJECTS }),
};

/* ------------------------------------------------------------------ */
/* /api/map/status                                                     */
/* ------------------------------------------------------------------ */

/**
 * Counts are the real ones, and they agree with what the Ideas and Builds
 * fixtures actually list: 23 open `proposal` issues, 11 open `approved`, and
 * 13 open pull requests on `claude/` branches. supply-chain-optimizer has an
 * empty queue because its loop is switched off.
 */
function statusFor(projectKey: string): MapStatus {
  if (projectKey === SECOND_PROJECT.key) {
    return {
      proposals: 0,
      approved: 0,
      openPRs: 0,
      agents: agentStatuses(SECOND_BADGES),
      project: SECOND_PROJECT.key,
      // Eight of the nine pausable workflows are off — the loop as a whole IS
      // paused here, and the banner should say so.
      loopPaused: true,
      aiEnabled: true,
    };
  }
  return {
    proposals: 23,
    approved: 11,
    openPRs: 13,
    agents: agentStatuses(DEFAULT_BADGES),
    project: DEMO_DEFAULT_PROJECT.key,
    loopPaused: false,
    aiEnabled: true,
  };
}

const STATUS_FIXTURE: DemoFixture = {
  match: "/api/map/status",
  body: (url) => statusFor(url.searchParams.get("project") ?? DEMO_DEFAULT_PROJECT.key),
};

/* ------------------------------------------------------------------ */
/* /api/map/agent/[id]                                                 */
/* ------------------------------------------------------------------ */

function agentMetaById(id: string): AgentMeta | undefined {
  return AGENTS.find((a) => a.id === id);
}

function workflowsFor(projectKey: string): Record<string, string> {
  return projectKey === SECOND_PROJECT.key ? DEMO_SECOND_REPO_WORKFLOWS : DEMO_REPO_WORKFLOWS;
}

function historyUrlForProject(projectKey: string, file: string): string {
  const repo = projectKey === SECOND_PROJECT.key ? SECOND_PROJECT.repo : DEMO_DEFAULT_PROJECT.repo;
  return `https://github.com/${DEMO_OWNER}/${repo}/commits/main/.github/workflows/${file}`;
}

function agentDetailFor(id: string, projectKey: string): AgentDetail | null {
  const meta = agentMetaById(id);
  if (!meta) return null;

  const rawYaml = workflowsFor(projectKey)[meta.file] ?? null;
  const capabilities: Capabilities = parseCapabilities(rawYaml, DEMO_REPO_MCP_JSON);

  // Run the real extractor rather than storing a second copy of the prompt.
  // `loop-metrics.yml` runs a plain script and has no `prompt: |` block, so
  // this reports exactly what the live route reports for it.
  const extracted = rawYaml ? extractPrompt(rawYaml) : ({ ok: false, reason: "no file" } as const);
  const promptExtractable = extracted.ok;
  const prompt = extracted.ok ? extracted.prompt : null;

  return {
    meta,
    runs: ((projectKey === SECOND_PROJECT.key ? SECOND_RUNS : DEFAULT_RUNS)[id] ?? []).slice(0, 5),
    capabilities,
    ref: "main",
    fileFound: rawYaml !== null,
    prompt,
    rawYaml,
    promptExtractable,
    extractionNote: promptExtractable
      ? undefined
      : "This is a plain reporting script — it doesn't call Claude, so there's no prompt to show.",
    editable: rawYaml !== null,
    historyUrl: historyUrlForProject(projectKey, meta.file),
    aiEnabled: true,
  };
}

const AGENT_DETAIL_FIXTURE: DemoFixture = {
  match: /^\/api\/map\/agent\/[^/]+$/,
  body: (url) => {
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const project = url.searchParams.get("project") ?? DEMO_DEFAULT_PROJECT.key;
    // Fall back to the Scout so a stray/unknown id still renders something
    // sensible rather than an empty drawer.
    return agentDetailFor(id, project) ?? agentDetailFor("scout", project);
  },
};

/* ------------------------------------------------------------------ */
/* /api/map/history + /api/map/history/[sha]                           */
/* ------------------------------------------------------------------ */

/**
 * Real commits on `main` touching `.github/workflows/`, newest first.
 *
 * Two further commits from the same listing are omitted here purely for size —
 * "Add dashboard-support workflows (#44)" and "Loop: roll out audited workflow
 * updates from the dashboard template", whose diffs are 27 KB and 121 KB of
 * patch text. Nothing was edited; entries were dropped whole or not at all.
 */
const HISTORY_COMMITS: HistoryCommit[] = [
  {
    sha: "91a814cbe0fbd4f0371b9ff738f451b6b60f4bec",
    message: "Security: gate the @mention agent behind a permission check",
    date: "2026-08-18T15:19:40Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/91a814cbe0fbd4f0371b9ff738f451b6b60f4bec",
  },
  {
    sha: "e02f1130fdd83b77620a3171ec993e35503a0307",
    message: "Loop: Builder claim-detection matches issue# in PR title + branch, not just body",
    date: "2026-07-23T03:10:39Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/e02f1130fdd83b77620a3171ec993e35503a0307",
  },
  {
    sha: "ae799942b906126975fa51af80e6bfc87295f743",
    message: "Loop: Scout dedups against open PRs + approved ideas (pull-requests: read)",
    date: "2026-07-23T03:10:33Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/ae799942b906126975fa51af80e6bfc87295f743",
  },
  {
    sha: "1f0a6863f23eef75f30323b307686485a471d03b",
    message: "loop-config: support prCap: \"unlimited\" (mirrors ideaQueueCap)",
    date: "2026-07-21T17:00:04Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/1f0a6863f23eef75f30323b307686485a471d03b",
  },
  {
    sha: "a94abd9bd1bbcbddfc97442be3a5610d59a2683d",
    message: "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix to an existing PR (GITHUB_TOKEN pushes don't cascade pull_request:synchronize, so the old verdict was staying stale forever)",
    date: "2026-07-20T14:53:29Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/a94abd9bd1bbcbddfc97442be3a5610d59a2683d",
  },
  {
    sha: "211a9201fbb07a4bf4fee46ff37de50068bffc4c",
    message: "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix to an existing PR (GITHUB_TOKEN pushes don't cascade pull_request:synchronize, so the old verdict was staying stale forever)",
    date: "2026-07-20T14:53:27Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/211a9201fbb07a4bf4fee46ff37de50068bffc4c",
  },
  {
    sha: "a5125580f8679805b50b7d06fc453e9cb2a3a939",
    message: "loop-config: replace hardcoded overnight cap-lift and unconditional self-pick with configurable .github/loop-config.json settings (default: approval-required, no time-of-day cap lift)",
    date: "2026-07-20T13:57:52Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/a5125580f8679805b50b7d06fc453e9cb2a3a939",
  },
  {
    sha: "fa3473d284d6397d014bcc868b7326fbf01f3974",
    message: "loop-config: replace hardcoded overnight cap-lift and unconditional self-pick with configurable .github/loop-config.json settings (default: approval-required, no time-of-day cap lift)",
    date: "2026-07-20T13:57:50Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/fa3473d284d6397d014bcc868b7326fbf01f3974",
  },
  {
    sha: "0443cd32c0da3398e9559b48015cbbf2707e04b4",
    message: "Builder: start on approval, never build the same issue twice, read the comments (#33)",
    date: "2026-07-14T20:08:42Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/0443cd32c0da3398e9559b48015cbbf2707e04b4",
  },
  {
    sha: "59c22f91ec6e5b26f111a6b1238093854751366a",
    message: "Let the Auditor review the Builder's PRs (allowed_bots) (#24)",
    date: "2026-07-14T16:15:40Z",
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/59c22f91ec6e5b26f111a6b1238093854751366a",
  },
];

/** The real per-file patches of each of those commits. */
type CommitDiff = {
  url: string;
  patches: { filename: string; status: string; patch: string | null }[];
};

const HISTORY_PATCHES: Record<string, CommitDiff> = {
  "91a814cbe0fbd4f0371b9ff738f451b6b60f4bec": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/91a814cbe0fbd4f0371b9ff738f451b6b60f4bec",
    patches: [
      {
        filename: ".github/workflows/claude-mention.yml",
        status: "modified",
        patch: `@@ -13,11 +13,66 @@ on:
     types: [opened]
 
 jobs:
-  claude:
+  # WHO IS ALLOWED TO STEER THIS AGENT.
+  # This repository is PUBLIC. Without this gate, the \`@claude\` trigger below is open to
+  # every GitHub account on earth: anyone could comment "@claude ..." on any issue and get
+  # an agent with Bash, Write, WebFetch, \`contents: write\` and \`actions: write\` running
+  # against this repo. That is arbitrary code execution by a stranger, not a mention.
+  #
+  # LEARNINGS.md line 18 concluded that plain \`Bash\` was acceptable "in an ephemeral CI
+  # container on a PRIVATE repo". That reasoning was correct when it was written. The repo
+  # later went public and this control never followed — so the gate goes here now, and the
+  # note in LEARNINGS.md is no longer a justification for leaving it off.
+  #
+  # Same fail-closed check as claude-redraft.yml: ask the API what this person can actually
+  # do here, accept only ADMIN or MAINTAIN, refuse identities that cannot be checked, and
+  # do it in a separate \`contents: read\` job so the permission lookup never runs alongside
+  # write access. If the permission cannot be read, the run does not proceed.
+  authorize:
     if: |
       contains(github.event.comment.body, '@claude') ||
       contains(github.event.issue.body, '@claude')
     runs-on: ubuntu-latest
+    timeout-minutes: 5
+    permissions:
+      contents: read
+    outputs:
+      ok: \${{ steps.check.outputs.ok }}
+    steps:
+      - name: Is the person who mentioned @claude allowed to steer the agent?
+        id: check
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+          REPO: \${{ github.repository }}
+          SENDER: \${{ github.event.sender.login }}
+        run: |
+          # A login is letters, digits and hyphens. Anything else (notably a \`name[bot]\`
+          # App identity) is not a person we can check, so it is not authorized.
+          case "$SENDER" in
+            '' | *[!A-Za-z0-9-]*)
+              echo "::notice::'@claude' was mentioned by '$SENDER', which is not a plain user account (App and bot identities cannot be permission-checked). Not running."
+              echo "ok=false" >> "$GITHUB_OUTPUT"
+              exit 0
+              ;;
+          esac
+
+          perm=$(gh api "repos/$REPO/collaborators/$SENDER/permission" --jq '.permission' 2>/dev/null || echo "")
+          echo "Permission of '$SENDER' on $REPO: \${perm:-(could not be read)}"
+          case "$perm" in
+            admin | maintain)
+              echo "Authorized — '$SENDER' is a repository $perm."
+              echo "ok=true" >> "$GITHUB_OUTPUT"
+              ;;
+            *)
+              echo "::notice::Ignoring the '@claude' mention from '$SENDER' (permission: \${perm:-none, or not readable}). Only repository admins and maintainers can steer this agent."
+              echo "ok=false" >> "$GITHUB_OUTPUT"
+              ;;
+          esac
+
+  claude:
+    needs: authorize
+    if: needs.authorize.outputs.ok == 'true'
+    runs-on: ubuntu-latest
     timeout-minutes: 45
     permissions:
       # Required by anthropics/claude-code-action: it mints its GitHub App token from OIDC.`,
      },
    ],
  },
  "e02f1130fdd83b77620a3171ec993e35503a0307": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/e02f1130fdd83b77620a3171ec993e35503a0307",
    patches: [
      {
        filename: ".github/workflows/claude-builder.yml",
        status: "modified",
        patch: `@@ -78,14 +78,21 @@ jobs:
           open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
 
-          # Issues that an OPEN agent PR already claims (via "Closes #N" in its body).
-          # Without this the Builder rebuilds an issue it is already building: on
-          # 2026-07-14 two runs both picked issue #15, both spent ~14 minutes, and
-          # produced two PRs for one feature. Telling the agent "I've started this" in
-          # an issue comment is NOT protection — the next run never reads it. This is.
-          claimed=$(gh pr list --state open --json headRefName,body \\
+          # Issues that an OPEN agent PR already claims. Without this the Builder rebuilds
+          # an issue it is already building: on 2026-07-14 two runs both picked issue #15,
+          # both spent ~14 minutes, and produced two PRs for one feature. Telling the agent
+          # "I've started this" in an issue comment is NOT protection — the next run never
+          # reads it. This is.
+          # Detected three ways: "Closes #N" in the body, "(#N)" in the PR title, and an
+          # issue number embedded in the branch name itself (e.g. \`claude/issue-15-foo\` or
+          # \`claude/foo-15\`) — the body scan alone misses PRs that only recorded the issue
+          # number in the title or branch.
+          claimed=$(gh pr list --state open --json headRefName,title,body \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))
-                       | (.body // "") | scan("(?i)closes #([0-9]+)") | .[0]]
+                       | ( (.body // "") | scan("(?i)closes #([0-9]+)") | .[0] ),
+                         ( (.title // "") | scan("\\\\(#([0-9]+)\\\\)") | .[0] ),
+                         ( (.headRefName // "") | scan("issue-([0-9]+)(?:-|$)") | .[0] ),
+                         ( (.headRefName // "") | scan("-([0-9]+)$") | .[0] )]
                   | unique | join(", ")')
           [ -z "$claimed" ] && claimed="(none)"
 `,
      },
    ],
  },
  "ae799942b906126975fa51af80e6bfc87295f743": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/ae799942b906126975fa51af80e6bfc87295f743",
    patches: [
      {
        filename: ".github/workflows/claude-scout.yml",
        status: "modified",
        patch: `@@ -24,6 +24,7 @@ jobs:
     permissions:
       contents: read
       issues: write
+      pull-requests: read
       id-token: write
     steps:
       - uses: actions/checkout@v6
@@ -59,6 +60,34 @@ jobs:
           # Actions expressions have no arithmetic — do the subtraction here.
           echo "room=$((CAP - pool))" >> "$GITHUB_OUTPUT"
 
+          # Also surface work that's already in flight elsewhere, so the agent doesn't
+          # propose something an open PR is already building, or something already
+          # approved and just waiting on the Builder. Best-effort: an empty list or a
+          # transient gh error must never fail this step.
+          open_prs=$(gh pr list --state open --json number,title,headRefName \\
+            --jq '.[] | "#\\(.number) \\(.title) (branch: \\(.headRefName))"' 2>/dev/null || true)
+          [ -z "$open_prs" ] && open_prs="(none)"
+
+          approved_ideas=$(gh issue list --state open --label approved --json number,title \\
+            --jq '.[] | "#\\(.number) \\(.title)"' 2>/dev/null || true)
+          [ -z "$approved_ideas" ] && approved_ideas="(none)"
+
+          echo "Open PRs in flight:"
+          echo "$open_prs"
+          echo "Approved ideas awaiting build:"
+          echo "$approved_ideas"
+
+          {
+            echo "open_prs<<PREOF"
+            echo "$open_prs"
+            echo "PREOF"
+          } >> "$GITHUB_OUTPUT"
+          {
+            echo "approved_ideas<<APPEOF"
+            echo "$approved_ideas"
+            echo "APPEOF"
+          } >> "$GITHUB_OUTPUT"
+
       - if: steps.gate.outputs.go == 'true'
         uses: anthropics/claude-code-action@v1
         with:
@@ -109,6 +138,19 @@ jobs:
                ignores. This is how you get better at your job.
             3. Read every open issue already labeled \`proposal\`
                (\`gh issue list --state open --label proposal\`). NEVER duplicate one.
+
+               Before proposing, also review these OPEN PULL REQUESTS and APPROVED ideas —
+               both are work already in flight, not just the \`proposal\` pool:
+
+               Open pull requests:
+               \${{ steps.gate.outputs.open_prs }}
+
+               Approved ideas (approved but not yet built):
+               \${{ steps.gate.outputs.approved_ideas }}
+
+               NEVER propose something already covered by an open PR or an already-approved
+               idea — it is already in flight. Your proposals must be genuinely NEW work not
+               represented anywhere in: open proposals, open PRs, or approved ideas.
             4. Spawn FOUR researchers with the Task tool, in ONE message, each with
                \`run_in_background: false\` so you block until all four have returned:
                - Competitors: who else does this, what do they have that we don't.`,
      },
    ],
  },
  "1f0a6863f23eef75f30323b307686485a471d03b": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/1f0a6863f23eef75f30323b307686485a471d03b",
    patches: [
      {
        filename: ".github/workflows/claude-builder.yml",
        status: "modified",
        patch: `@@ -58,6 +58,9 @@ jobs:
         id: config
         run: |
           cap=$(jq -r '.prCap // 3' .github/loop-config.json 2>/dev/null || echo 3)
+          if [ "$cap" = "unlimited" ] || [ "$cap" = "null" ] || [ -z "$cap" ]; then
+            cap=999999
+          fi
           autonomous=$(jq -r '.autonomousBuildEnabled // false' .github/loop-config.json 2>/dev/null || echo false)
           [ "$autonomous" = "true" ] || autonomous=false
           echo "Review-queue cap: $cap | Autonomous build: $autonomous"`,
      },
    ],
  },
  "a94abd9bd1bbcbddfc97442be3a5610d59a2683d": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/a94abd9bd1bbcbddfc97442be3a5610d59a2683d",
    patches: [
      {
        filename: ".github/workflows/claude-mention.yml",
        status: "modified",
        patch: `@@ -24,12 +24,36 @@ jobs:
       pull-requests: write
       issues: write
       id-token: write
-      actions: read
+      actions: write
     steps:
       - uses: actions/checkout@v6
         with:
           fetch-depth: 0
 
+      # If this mention is happening on an existing PR (not a plain issue), note where
+      # its branch is RIGHT NOW so we can tell afterward whether the agent actually
+      # pushed something — see "Re-check the PR" below for why that matters.
+      - name: Resolve PR context
+        id: pr
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          if [ "\${{ github.event_name }}" = "pull_request_review_comment" ]; then
+            pr="\${{ github.event.pull_request.number }}"
+          elif [ "\${{ github.event_name }}" = "issue_comment" ] && [ -n "\${{ github.event.issue.pull_request.url }}" ]; then
+            pr="\${{ github.event.issue.number }}"
+          else
+            pr=""
+          fi
+          echo "pr_number=$pr" >> "$GITHUB_OUTPUT"
+          if [ -n "$pr" ]; then
+            before=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
+            echo "before_sha=$before" >> "$GITHUB_OUTPUT"
+            echo "Mention is on PR #$pr, currently at $before"
+          else
+            echo "Mention is not on an existing PR — nothing to re-check afterward."
+          fi
+
       - uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
@@ -39,3 +63,28 @@ jobs:
             --max-turns 40
             --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
             --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it. If the owner asks you to change what an issue should cover, EDIT THE ISSUE BODY to match — do not just reply in a comment. The Builder plans from the body, so scope changes that live only in a comment can be missed."
+
+      # This agent's push uses the default GITHUB_TOKEN identity, which GitHub's own
+      # recursion-prevention rule silently excludes from ever triggering
+      # \`pull_request: synchronize\` — so the Auditor, Demo, and plain-CI tests would
+      # otherwise never re-run after a follow-up fix lands on an existing PR, leaving
+      # a stale verdict on screen forever even though the code actually changed.
+      # workflow_dispatch is explicitly exempt from that rule, so trigger it by hand,
+      # and only when something on the PR's branch actually moved.
+      - name: Re-check the PR if this mention pushed a new commit to it
+        if: steps.pr.outputs.pr_number != ''
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          pr="\${{ steps.pr.outputs.pr_number }}"
+          before="\${{ steps.pr.outputs.before_sha }}"
+          after_sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
+          after_ref=$(gh pr view "$pr" --json headRefName --jq .headRefName)
+          if [ "$after_sha" = "$before" ]; then
+            echo "No new commit on PR #$pr — nothing to re-check."
+            exit 0
+          fi
+          echo "PR #$pr moved $before -> $after_sha — re-triggering the review pipeline."
+          gh workflow run claude-audit.yml --ref main -f pr_number="$pr" || echo "::warning::Couldn't queue a re-audit."
+          gh workflow run claude-demo.yml --ref main -f pr_number="$pr" || echo "::warning::Couldn't queue a re-demo."
+          gh workflow run repo-tests.yml --ref "$after_ref" || echo "::warning::Couldn't queue a re-test."`,
      },
    ],
  },
  "211a9201fbb07a4bf4fee46ff37de50068bffc4c": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/211a9201fbb07a4bf4fee46ff37de50068bffc4c",
    patches: [
      {
        filename: ".github/workflows/claude-audit.yml",
        status: "modified",
        patch: `@@ -8,10 +8,15 @@ name: Claude — Auditor (adversarial PR review)
 on:
   pull_request:
     types: [opened, synchronize, reopened]
+  workflow_dispatch:
+    inputs:
+      pr_number:
+        description: "PR number to (re)audit"
+        required: true
 
 # A new push supersedes an in-flight audit of the same PR — don't pay twice.
 concurrency:
-  group: audit-\${{ github.event.pull_request.number }}
+  group: audit-\${{ github.event.pull_request.number || github.event.inputs.pr_number }}
   cancel-in-progress: true
 
 jobs:
@@ -24,10 +29,35 @@ jobs:
       issues: write
       id-token: write
     steps:
+      # Work out which PR we're on. Handles both the normal pull_request trigger
+      # AND a manual/scripted re-run (workflow_dispatch) — the latter matters
+      # because a follow-up push from the @mention agent uses the default
+      # GITHUB_TOKEN identity, which GitHub's own recursion-prevention rule
+      # silently excludes from ever firing \`pull_request: synchronize\` — so
+      # without this, a fix pushed onto an existing PR would never get
+      # re-audited, and the stale verdict would sit there indefinitely.
+      - name: Resolve PR number
+        id: meta
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          if [ "\${{ github.event_name }}" = "workflow_dispatch" ]; then
+            pr="\${{ github.event.inputs.pr_number }}"
+          else
+            pr="\${{ github.event.pull_request.number }}"
+          fi
+          echo "PR under review: #$pr"
+          echo "pr_number=$pr" >> "$GITHUB_OUTPUT"
+
       - uses: actions/checkout@v6
         with:
           fetch-depth: 0
 
+      - name: Check out the PR branch
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: gh pr checkout \${{ steps.meta.outputs.pr_number }}
+
       - uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
@@ -41,7 +71,7 @@ jobs:
             --max-turns 60
             --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
           prompt: |
-            You are the ADVERSARIAL AUDITOR for PR #\${{ github.event.pull_request.number }}
+            You are the ADVERSARIAL AUDITOR for PR #\${{ steps.meta.outputs.pr_number }}
             in \${{ github.repository }}. Your job is to find reasons this PR should NOT be
             merged. Assume it is subtly broken until you prove otherwise.
 `,
      },
    ],
  },
  "a5125580f8679805b50b7d06fc453e9cb2a3a939": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/a5125580f8679805b50b7d06fc453e9cb2a3a939",
    patches: [
      {
        filename: ".github/workflows/claude-scout.yml",
        status: "modified",
        patch: `@@ -2,8 +2,11 @@ name: Claude — Scout (finds work worth doing)
 
 # Runs every hour. Researches the market + the codebase, then files issues labeled
 # \`proposal\`. It NEVER writes code — it only stocks the shelf that the Builder picks
-# from. A cheap bash gate keeps the pool at 8 open proposals, so most hourly runs
-# cost ~15 seconds and never boot an agent.
+# from. A cheap bash gate keeps the open-proposal pool under the repo's configured
+# cap (\`.github/loop-config.json\`, \`ideaQueueCap\` — set from the dashboard's Ideas
+# page; defaults to 25 if the file is missing), so most hourly runs cost ~15 seconds
+# and never boot an agent. Because this runs every hour regardless of time of day,
+# ideas accumulate steadily throughout the day up to the cap, not in an overnight burst.
 
 on:
   schedule:
@@ -25,23 +28,36 @@ jobs:
     steps:
       - uses: actions/checkout@v6
 
+      # Read the per-project cap. Missing file or missing field both fall back to 25 —
+      # this repo may not have been backfilled with a loop-config.json yet.
+      - name: Read loop config
+        id: config
+        run: |
+          cap=$(jq -r '.ideaQueueCap // 25' .github/loop-config.json 2>/dev/null || echo 25)
+          if [ "$cap" = "unlimited" ] || [ "$cap" = "null" ] || [ -z "$cap" ]; then
+            cap=999999
+          fi
+          echo "Idea queue cap: $cap"
+          echo "cap=$cap" >> "$GITHUB_OUTPUT"
+
       # Cheap pre-flight in plain bash so we never boot an expensive agent for nothing.
       - name: Check the proposal pool
         id: gate
         env:
           GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+          CAP: \${{ steps.config.outputs.cap }}
         run: |
           pool=$(gh issue list --state open --label proposal --json number --jq 'length')
-          echo "Open proposals: $pool"
-          if [ "$pool" -ge 8 ]; then
+          echo "Open proposals: $pool / $CAP"
+          if [ "$pool" -ge "$CAP" ]; then
             echo "Pool is full — standing down. An unread queue is noise, not a backlog."
             echo "go=false" >> "$GITHUB_OUTPUT"
           else
             echo "go=true" >> "$GITHUB_OUTPUT"
           fi
           echo "pool=$pool" >> "$GITHUB_OUTPUT"
           # Actions expressions have no arithmetic — do the subtraction here.
-          echo "room=$((8 - pool))" >> "$GITHUB_OUTPUT"
+          echo "room=$((CAP - pool))" >> "$GITHUB_OUTPUT"
 
       - if: steps.gate.outputs.go == 'true'
         uses: anthropics/claude-code-action@v1
@@ -80,7 +96,8 @@ jobs:
             green and the owner got nothing. Do not repeat it.
             ────────────────────────────────────────────────────────────────────────
 
-            There are currently \${{ steps.gate.outputs.pool }} open proposals. The pool caps at 8.
+            There are currently \${{ steps.gate.outputs.pool }} open proposals. The pool caps at
+            \${{ steps.config.outputs.cap }}.
             File at most \${{ steps.gate.outputs.room }} new issues — fewer if you
             only found fewer things genuinely worth doing.
 `,
      },
    ],
  },
  "fa3473d284d6397d014bcc868b7326fbf01f3974": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/fa3473d284d6397d014bcc868b7326fbf01f3974",
    patches: [
      {
        filename: ".github/workflows/claude-builder.yml",
        status: "modified",
        patch: `@@ -9,15 +9,16 @@ name: Claude — Builder (implements work, keeps your queue full)
 # because the Builder simply never woke up. Now approving from the phone starts a build
 # within a minute, and the schedule is only a safety net.
 #
-# THE QUEUE RULE:
-#   - Daytime (7am–11pm ET): at most 3 agent PRs may be open and waiting on you at once.
-#     Merge or close one and a slot frees up; the next run fills it.
-#   - Overnight (11pm–7am ET): the cap is lifted, so work piles up while you sleep.
-#
-# WHAT IT BUILDS:
-#   - An issue you labeled \`approved\` always jumps the queue and gets built first.
-#   - Otherwise it picks the strongest open \`proposal\` on its own. You do not have to
-#     approve anything for the loop to keep moving.
+# THE QUEUE RULE — both numbers below are configurable per-project from the dashboard's
+# Ideas page, stored in this repo's \`.github/loop-config.json\`. No time-of-day special
+# casing: the same rule applies at 3pm and at 3am.
+#   - \`prCap\` (default 3): at most this many agent PRs may be open and waiting on you at
+#     once. Merge or close one and a slot frees up; the next run fills it.
+#   - \`autonomousBuildEnabled\` (default false):
+#       - OFF — the Builder only ever builds an issue you've explicitly labeled
+#         \`approved\`. It is never told that self-picking a proposal is an option.
+#       - ON — if nothing is \`approved\`, it picks the strongest open \`proposal\` on its
+#         own. You do not have to approve anything for the loop to keep moving.
 #   - It NEVER picks an issue that already has an open \`claude/\` PR against it.
 #
 # A cheap bash gate runs first, so a run with no room and no work costs ~15 seconds.
@@ -49,22 +50,28 @@ jobs:
         with:
           fetch-depth: 0
 
+      # Read this repo's automation settings. Missing file or missing field falls back
+      # to the safe default (prCap 3, autonomous build OFF) — a repo that hasn't been
+      # backfilled with loop-config.json yet, or hasn't visited the Ideas page settings
+      # panel, gets the conservative behavior, never the permissive one.
+      - name: Read loop config
+        id: config
+        run: |
+          cap=$(jq -r '.prCap // 3' .github/loop-config.json 2>/dev/null || echo 3)
+          autonomous=$(jq -r '.autonomousBuildEnabled // false' .github/loop-config.json 2>/dev/null || echo false)
+          [ "$autonomous" = "true" ] || autonomous=false
+          echo "Review-queue cap: $cap | Autonomous build: $autonomous"
+          echo "cap=$cap" >> "$GITHUB_OUTPUT"
+          echo "autonomous=$autonomous" >> "$GITHUB_OUTPUT"
+
       # Cheap pre-flight in plain bash so we never boot an expensive agent for nothing.
       - name: Check the queue
         id: gate
         env:
           GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+          CAP: \${{ steps.config.outputs.cap }}
+          AUTONOMOUS: \${{ steps.config.outputs.autonomous }}
         run: |
-          hour=$(TZ=America/New_York date +%H)
-          hour=\${hour#0}
-          if [ "$hour" -ge 23 ] || [ "$hour" -lt 7 ]; then
-            cap=99
-            echo "Overnight (\${hour}:00 ET) — review-queue cap lifted."
-          else
-            cap=3
-            echo "Daytime (\${hour}:00 ET) — review-queue cap is 3."
-          fi
-
           open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
 
@@ -81,15 +88,28 @@ jobs:
 
           approved=$(gh issue list --state open --label approved --json number --jq 'length')
           proposals=$(gh issue list --state open --label proposal --json number --jq 'length')
-          echo "Agent PRs awaiting you: $open_prs / $cap | approved: $approved | proposals: $proposals"
+          echo "Agent PRs awaiting you: $open_prs / $CAP | approved: $approved | proposals: $proposals | autonomous: $AUTONOMOUS"
           echo "Already claimed by an open PR: $claimed"
           echo "claimed=$claimed" >> "$GITHUB_OUTPUT"
 
-          if [ "$open_prs" -ge "$cap" ]; then
+          if [ "$AUTONOMOUS" = "true" ]; then
+            pick_rule='2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` — judge by value to the product against effort and risk, and prefer small. You are trusted to choose. Do not ask, do not build more than one.'
+            nothing_to_build=$([ "$approved" -eq 0 ] && [ "$proposals" -eq 0 ] && echo true || echo false)
+          else
+            pick_rule='2. If none are approved, STOP without opening a PR. Autonomous build is OFF for this project — you may only build issues the owner has explicitly labeled \`approved\`. Do not self-pick a proposal, no matter how strong it looks, and do not comment suggesting one — the owner has chosen to review before anything gets built.'
+            nothing_to_build=$([ "$approved" -eq 0 ] && echo true || echo false)
+          fi
+          {
+            echo "pick_rule<<PICKEOF"
+            echo "$pick_rule"
+            echo "PICKEOF"
+          } >> "$GITHUB_OUTPUT"
+
+          if [ "$open_prs" -ge "$CAP" ]; then
             echo "Your review queue is full — standing down. Merge or close one to free a slot."
             echo "go=false" >> "$GITHUB_OUTPUT"
-          elif [ "$approved" -eq 0 ] && [ "$proposals" -eq 0 ]; then
-            echo "Nothing to build — the shelf is empty. Scout will restock it."
+          elif [ "$nothing_to_build" = "true" ]; then
+            echo "Nothing to build — the shelf is empty (or autonomous build is off and nothing is approved). Scout will restock it."
             echo "go=false" >> "$GITHUB_OUTPUT"
           else
             echo "go=true" >> "$GITHUB_OUTPUT"
@@ -146,9 +166,7 @@ jobs:
 
             PICK — in this strict order, skipping anything in the off-limits list above:
             1. The OLDEST open issue labeled \`approved\`. The owner asked for it; it always wins.
-            2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` —
-               judge by value to the product against effort and risk, and prefer small. You are
-               trusted to choose. Do not ask, do not build more than one.
+            \${{ steps.gate.outputs.pick_rule }}
             3. If neither exists, stop without opening a PR.
 
             READ THE WHOLE CONVERSATION, NOT JUST THE ISSUE BODY:`,
      },
    ],
  },
  "0443cd32c0da3398e9559b48015cbbf2707e04b4": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/0443cd32c0da3398e9559b48015cbbf2707e04b4",
    patches: [
      {
        filename: ".github/workflows/claude-builder.yml",
        status: "modified",
        patch: `@@ -1,7 +1,13 @@
 name: Claude — Builder (implements work, keeps your queue full)
 
-# Runs every 30 minutes. Opens ONE pull request per run, and only if your review queue
-# has room.
+# Runs the moment you label an issue \`approved\`, and every 30 minutes as a backstop.
+# Opens ONE pull request per run, and only if your review queue has room.
+#
+# WHY THE \`labeled\` TRIGGER: GitHub's cron is best-effort and silently drops runs under
+# load — this */30 schedule really fired at 14:02, 15:59, 16:51, 17:24, 18:42 on
+# 2026-07-14. The owner approved three issues and watched nothing happen for an hour,
+# because the Builder simply never woke up. Now approving from the phone starts a build
+# within a minute, and the schedule is only a safety net.
 #
 # THE QUEUE RULE:
 #   - Daytime (7am–11pm ET): at most 3 agent PRs may be open and waiting on you at once.
@@ -12,12 +18,15 @@ name: Claude — Builder (implements work, keeps your queue full)
 #   - An issue you labeled \`approved\` always jumps the queue and gets built first.
 #   - Otherwise it picks the strongest open \`proposal\` on its own. You do not have to
 #     approve anything for the loop to keep moving.
+#   - It NEVER picks an issue that already has an open \`claude/\` PR against it.
 #
 # A cheap bash gate runs first, so a run with no room and no work costs ~15 seconds.
 
 on:
+  issues:
+    types: [labeled]
   schedule:
-    - cron: "*/30 * * * *" # every 30 minutes
+    - cron: "*/30 * * * *" # backstop only — GitHub drops these regularly
   workflow_dispatch:
 
 concurrency:
@@ -26,6 +35,8 @@ concurrency:
 
 jobs:
   build:
+    # On a label event, only wake up for \`approved\` — not for every label anyone adds.
+    if: github.event_name != 'issues' || github.event.label.name == 'approved'
     runs-on: ubuntu-latest
     timeout-minutes: 90
     permissions:
@@ -56,9 +67,23 @@ jobs:
 
           open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
+
+          # Issues that an OPEN agent PR already claims (via "Closes #N" in its body).
+          # Without this the Builder rebuilds an issue it is already building: on
+          # 2026-07-14 two runs both picked issue #15, both spent ~14 minutes, and
+          # produced two PRs for one feature. Telling the agent "I've started this" in
+          # an issue comment is NOT protection — the next run never reads it. This is.
+          claimed=$(gh pr list --state open --json headRefName,body \\
+            --jq '[.[] | select(.headRefName | startswith("claude/"))
+                       | (.body // "") | scan("(?i)closes #([0-9]+)") | .[0]]
+                  | unique | join(", ")')
+          [ -z "$claimed" ] && claimed="(none)"
+
           approved=$(gh issue list --state open --label approved --json number --jq 'length')
           proposals=$(gh issue list --state open --label proposal --json number --jq 'length')
           echo "Agent PRs awaiting you: $open_prs / $cap | approved: $approved | proposals: $proposals"
+          echo "Already claimed by an open PR: $claimed"
+          echo "claimed=$claimed" >> "$GITHUB_OUTPUT"
 
           if [ "$open_prs" -ge "$cap" ]; then
             echo "Your review queue is full — standing down. Merge or close one to free a slot."
@@ -105,17 +130,39 @@ jobs:
             that.
             ────────────────────────────────────────────────────────────────────────
 
-            PICK — in this strict order:
+            ────────────────────────────────────────────────────────────────────────
+            NEVER BUILD AN ISSUE THAT IS ALREADY BEING BUILT
+
+            These issues already have an OPEN pull request against them:
+                \${{ steps.gate.outputs.claimed }}
+
+            They are OFF LIMITS. Do not pick them. Do not "improve" them.
+
+            This happened for real on 2026-07-14: two Builder runs both picked issue #15, both
+            spent fourteen minutes, and produced two pull requests for one feature. The owner
+            had to throw one away. Commenting "I've started this" on the issue is NOT enough
+            protection, because the next run does not read it — this list is the protection.
+            ────────────────────────────────────────────────────────────────────────
+
+            PICK — in this strict order, skipping anything in the off-limits list above:
             1. The OLDEST open issue labeled \`approved\`. The owner asked for it; it always wins.
             2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` —
                judge by value to the product against effort and risk, and prefer small. You are
                trusted to choose. Do not ask, do not build more than one.
             3. If neither exists, stop without opening a PR.
 
-            Comment on the issue you picked saying you have started, so a later run does not
-            pick it up too.
+            READ THE WHOLE CONVERSATION, NOT JUST THE ISSUE BODY:
+            run \`gh issue view <n> --comments\`. The owner often clarifies, narrows, or changes
+            his mind in the comments — "only do the YouTube part", "skip the migration", "keep
+            it small". **His comments OVERRIDE the original issue body.** Building the body while
+            ignoring a comment that contradicts it means building the wrong thing. If a comment
+            genuinely conflicts with the body and you cannot tell which he means, build the
+            SMALLER interpretation and say so in the PR.
+
+            Comment on the issue you picked saying you have started, so a human watching knows.
 
-            PLAN: restate the issue as an explicit acceptance checklist before coding.
+            PLAN: restate the issue — as amended by the comments — as an explicit acceptance
+            checklist before coding.
 
             BUILD (spend tokens here — this is the point):
             - Spawn THREE agents with the Task tool, in ONE message, each with`,
      },
      {
        filename: ".github/workflows/claude-mention.yml",
        status: "modified",
        patch: `@@ -38,4 +38,4 @@ jobs:
             --model opus
             --max-turns 40
             --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
-            --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it."
+            --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it. If the owner asks you to change what an issue should cover, EDIT THE ISSUE BODY to match — do not just reply in a comment. The Builder plans from the body, so scope changes that live only in a comment can be missed."`,
      },
    ],
  },
  "59c22f91ec6e5b26f111a6b1238093854751366a": {
    url: "https://github.com/ApagPlayz/content-generation-platform/commit/59c22f91ec6e5b26f111a6b1238093854751366a",
    patches: [
      {
        filename: ".github/workflows/claude-audit.yml",
        status: "modified",
        patch: `@@ -31,6 +31,11 @@ jobs:
       - uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          # The Builder's PRs are authored by the \`claude\` bot. Without this, the action's
+          # bot-loop guard refuses to run and the Auditor never reviews a single agent PR —
+          # which is the entire point of the Auditor. Scoped to \`claude\`, not \`*\`.
+          allowed_bots: "claude"
+          show_full_output: true
           claude_args: |
             --model opus
             --max-turns 60`,
      },
    ],
  },
};

const HISTORY_FIXTURE: DemoFixture = {
  match: "/api/map/history",
  body: () => ({ commits: HISTORY_COMMITS }),
};

const HISTORY_DIFF_FIXTURE: DemoFixture = {
  match: /^\/api\/map\/history\/[^/]+$/,
  body: (url) => {
    const sha = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    return (
      HISTORY_PATCHES[sha] ?? { url: demoRepoUrl(`commit/${sha}`), patches: [] }
    );
  },
};

/* ------------------------------------------------------------------ */
/* /api/map/power                                                      */
/* ------------------------------------------------------------------ */

/** Exactly what `gh workflow list --all` reports for each repo. */
const POWER_FIXTURE: DemoFixture = {
  match: "/api/map/power",
  body: (url) => {
    const paused = (url.searchParams.get("project") ?? DEMO_DEFAULT_PROJECT.key) === SECOND_PROJECT.key;
    const badges = paused ? SECOND_BADGES : DEFAULT_BADGES;
    return {
      workflows: AGENTS.map((meta) => {
        const enabled = badges[meta.id]?.enabled ?? true;
        return {
          file: meta.file,
          name: meta.label,
          state: enabled ? "active" : "disabled_manually",
          enabled,
          isMention: meta.id === "mention",
        };
      }),
      loopPaused: paused,
      // null: nothing was master-paused from the dashboard, so there is no
      // pre-pause record for Resume to read — the switches were flipped by
      // hand on GitHub.
      pauseRecord: null,
    };
  },
};

/* ------------------------------------------------------------------ */
/* /api/map/template + /api/map/template/drift                        */
/* ------------------------------------------------------------------ */

const TEMPLATE_WORKFLOW_ROWS = Object.entries(DEMO_TEMPLATE_WORKFLOWS)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, content]) => ({ file, content, hash: templateContentHash(content) }));

const TEMPLATE_FILE_ROWS = Object.entries(DEMO_TEMPLATE_FILES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, content]) => ({
    file,
    content,
    hash: templateContentHash(content),
    target: TEMPLATE_FILE_TARGETS[file] ?? null,
  }));

const TEMPLATE_FIXTURE: DemoFixture = {
  match: "/api/map/template",
  body: () => ({
    exists: TEMPLATE_WORKFLOW_ROWS.length > 0,
    workflows: TEMPLATE_WORKFLOW_ROWS,
    files: TEMPLATE_FILE_ROWS,
  }),
};

/**
 * Drift, computed rather than asserted.
 *
 * `computeTemplateDrift` in lib/loop-template.ts does exactly this against a
 * live repo; here the "live" side is the verbatim installed workflows in
 * fixtures-workflows.ts, and the diff comes from the same `unifiedDiff`. The
 * answer is honest: the pilot HAS drifted from the template, because template
 * changes are rolled out deliberately rather than automatically.
 */
function driftFor(projectKey: string) {
  const installed = workflowsFor(projectKey);
  const names = [
    ...new Set([...Object.keys(DEMO_TEMPLATE_WORKFLOWS), ...Object.keys(installed)]),
  ].sort();
  const files = names.map((file) => {
    const t = DEMO_TEMPLATE_WORKFLOWS[file];
    const r = installed[file];
    if (t === undefined) {
      return {
        file,
        status: "extra-in-repo" as const,
        diff: unifiedDiff("", r ?? "", `template/${file} (absent)`, `repo/${file}`),
      };
    }
    if (r === undefined) {
      return {
        file,
        status: "missing-in-repo" as const,
        diff: unifiedDiff(t, "", `template/${file}`, `repo/${file} (absent)`),
      };
    }
    if (t === r) return { file, status: "identical" as const, diff: "" };
    return {
      file,
      status: "repo-behind-or-diverged" as const,
      diff: unifiedDiff(t, r, `template/${file}`, `repo/${file}`),
    };
  });

  const counts = {
    identical: 0,
    "repo-behind-or-diverged": 0,
    "missing-in-repo": 0,
    "extra-in-repo": 0,
  };
  for (const f of files) counts[f.status]++;

  const isSecond = projectKey === SECOND_PROJECT.key;
  return {
    project: projectKey,
    projectLabel: isSecond ? SECOND_PROJECT.label : DEMO_DEFAULT_PROJECT.label,
    inSync: counts["repo-behind-or-diverged"] === 0 && counts["missing-in-repo"] === 0,
    templateEmpty: false,
    counts,
    files,
  };
}

const TEMPLATE_DRIFT_FIXTURE: DemoFixture = {
  match: "/api/map/template/drift",
  body: (url) => driftFor(url.searchParams.get("project") ?? DEMO_DEFAULT_PROJECT.key),
};

/* ------------------------------------------------------------------ */
/* /api/map/projects/checklist                                         */
/* ------------------------------------------------------------------ */

const CHECKLIST_FIXTURE: DemoFixture = {
  match: "/api/map/projects/checklist",
  body: (url) => {
    const project =
      url.searchParams.get("project") === SECOND_PROJECT.key ? SECOND_PROJECT : DEMO_DEFAULT_PROJECT;
    const repo = `${DEMO_OWNER}/${project.repo}`;
    return {
      // true: both repos really do hold the CLAUDE_CODE_OAUTH_TOKEN secret —
      // that is how their agents have been running.
      secret: true,
      secretHelp: `Secrets can't be copied between repos. In a terminal: gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo} — or paste the token by hand on GitHub under Settings → Secrets and variables → Actions.`,
      app: {
        status: "unknown",
        note:
          "The dashboard can't check GitHub App installs with its token. Make sure the Claude GitHub app covers this repo — it takes one minute — and the first agent run will prove it either way.",
        url: "https://github.com/apps/claude",
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* /api/launch/status                                                  */
/* ------------------------------------------------------------------ */

/**
 * The real route is LOCAL-ONLY (it 404s unless LOOP_DASHBOARD_LOCAL_MODE is
 * set) because it reads the owner's own Mac. A public visitor has no local
 * machine for the demo to probe, so the honest answer is simply "no launcher
 * configured here".
 */
const LAUNCH_STATUS_FIXTURE: DemoFixture = {
  match: "/api/launch/status",
  body: () => ({
    configured: false,
    running: false,
    url: null,
    kind: null,
    analyzedAt: null,
    notes: null,
  }),
};

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

export const MAP_FIXTURES: DemoFixture[] = [
  PROJECTS_FIXTURE,
  STATUS_FIXTURE,
  AGENT_DETAIL_FIXTURE,
  HISTORY_FIXTURE,
  HISTORY_DIFF_FIXTURE,
  POWER_FIXTURE,
  TEMPLATE_FIXTURE,
  TEMPLATE_DRIFT_FIXTURE,
  CHECKLIST_FIXTURE,
  LAUNCH_STATUS_FIXTURE,
];
