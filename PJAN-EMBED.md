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
| `eventsUrl` | yes | Same-origin SSE or JSON `{ events: SimulationEvent[] }` |
| `metaUrl` | no | Optional `{ status, codexHome }` |

Host page must mount:

```html
<div id="root"></div>
<link rel="stylesheet" href="./index.css" />
<script src="./index.js"></script>
```

## Events

Prefer stock types (`agent_spawn`, `tool_call_*`, `message`, `context_update`, `subagent_*`).
pjan aliases also accepted: `pjan_desk`, `pjan_stage`, `pjan_letter`, `pjan_pin`, `pjan_document`, `pjan_economics`, `pjan_evidence_routes`.

Every event should carry `sessionId` matching the window.
