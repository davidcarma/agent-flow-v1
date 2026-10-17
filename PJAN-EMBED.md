# pjan.ai embed contract

Agent Flow ships an iframe build for the pjan workspace session monitor.

## Build

```bash
pnpm i
pnpm run build:embed
```

Output: `dist/embed/index.js` + `dist/embed/index.css` (IIFE).

## Bootstrap query params

| Param | Required | Meaning |
|-------|----------|---------|
| `sessionId` | yes | Ops session id; canvas drops other sessions |
| `host` | no | Set `1` for host-managed snapshots. This disables all iframe EventSource, fetch and polling. |
| `eventsUrl` | non-host only | Same-origin SSE or JSON `{ events: SimulationEvent[] }` |
| `metaUrl` | no | Optional `{ status, codexHome }`, never fetched in host mode |

Host page must mount:

```html
<div id="root"></div>
<link rel="stylesheet" href="./index.css" />
<script src="./index.js"></script>
```

## Events

Prefer stock types (`agent_spawn`, `tool_call_*`, `message`, `context_update`, `subagent_*`).
pjan aliases also accepted: `pjan_desk`, `pjan_stage`, `pjan_letter`, `pjan_pin`, `pjan_document`, `pjan_economics`, `pjan_evidence_routes`.

Every event must carry `sessionId` matching the window in snapshot mode. Events with absent or foreign session ids are rejected.

## Host snapshot protocol

Use `?host=1&sessionId=<id>`. The iframe installs its listener, then sends `{ source: 'agent-flow:embed', type: 'ready', sessionId }` to its parent at `location.origin`. Replay the latest snapshot after every ready message.

The host sends `{ source: 'pjan:agent-flow', type: 'snapshot', sessionId, revision, events, inventory, summary }`. Only messages whose origin equals `location.origin`, whose source is `window.parent`, and whose sessionId exactly matches the bootstrap id are accepted. Each new revision replaces/replays the entire graph, not an append. Numeric stale revisions and identical revisions are ignored. Use increasing numeric revisions and a stable `eventId` per event. Event bodies and metadata are not truncated for identity or inspection. Existing node positions and pinned drag state survive replacement when ids remain stable.

`inventory` is an array of `{ id, kind, label, status, parentId, detail }`. The permanent side panel filters all families and displays the selected item's complete JSON. Native node/tool selection also opens full metadata there. Use the native node id or tool callId as inventory id for selection linking. `summary` supports `status`, `toolCount`, `llmCount`, `tokens`, `costUsd`, and `evidenceCount`; these values are shown directly rather than estimated.

Send `{ source: 'pjan:agent-flow', type: 'visibility', sessionId, visible: false }` before hide/minimize. This stops simulation and canvas animation. Showing again keeps the graph paused until explicit Play. Terminal snapshots also settle paused. Play, restart/replay, scrub, speed, selection, drag, pan and zoom remain available. Completed native nodes and tool calls remain inspectable in embed mode. Normal extension behavior is unchanged.

Tool start/end payloads must include the same stable `callId` plus `agent` and `tool`. Concurrent calls to the same tool remain separate. Parent completion never rewrites child or tool outcomes in snapshot mode. Running pjan nodes render thinking, failed nodes error, skipped nodes paused, and pending/idle nodes idle; the exact original status remains in the inspector.

Verification: `pnpm test`, `pnpm --filter agent-flow-web exec tsc --noEmit --incremental false`, and `pnpm run build:embed`. Focused contracts live in `web/hooks/simulation/embed-snapshot.test.ts`.
