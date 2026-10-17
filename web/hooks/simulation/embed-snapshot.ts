import type { SimulationEvent } from '../../lib/agent-types'
import { createEmptyState, type SimulationState } from './types'
import { processEvent, type ProcessEventContext } from './process-event'

export interface EmbedInventoryItem {
  id: string
  kind: string
  label: string
  status?: string
  parentId?: string | null
  detail?: unknown
}
export interface EmbedSnapshot {
  source: 'pjan:agent-flow'
  type: 'snapshot'
  sessionId: string
  revision: number | string
  events: SimulationEvent[]
  inventory: EmbedInventoryItem[]
  summary: { status?: string; toolCount?: number; llmCount?: number; tokens?: number; costUsd?: number; evidenceCount?: number }
}

export function acceptsHostMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, origin: string, parent: MessageEventSource, sessionId: string | null): boolean {
  return !!sessionId && event.origin === origin && event.source === parent && event.data?.source === 'pjan:agent-flow' && event.data.sessionId === sessionId
}

export function terminalSnapshot(snapshot: EmbedSnapshot | null): boolean {
  return /^(done|complete|completed|succeeded|failed|error|aborted|cancelled|canceled)$/i.test(snapshot?.summary?.status || '')
}

/** Full replacement, never an append. Stable ids dedupe events without truncating payloads. */
export function replayEmbedSnapshot(events: readonly SimulationEvent[], sessionId: string, ctx: ProcessEventContext, previous?: SimulationState, targetTime = Infinity): SimulationState {
  const byId = new Map<string, SimulationEvent>()
  for (const event of events) {
    if (event.sessionId !== sessionId) continue
    const key = event.eventId || JSON.stringify(event)
    byId.set(key, event)
  }
  const log = [...byId.values()].sort((a, b) => a.time - b.time)
  let next = createEmptyState({ speed: previous?.speed || 1, eventLog: log, maxTimeReached: Math.max(0, ...log.map(e => e.time)) })
  const context = { ...ctx, embedMode: true, skipForceSync: true, blockIdCounter: { current: 0 } }
  for (const event of log) {
    if (event.time > targetTime) break
    next = processEvent(event, { ...next, currentTime: event.time }, context)
    next.eventIndex++
  }
  for (const [id, agent] of next.agents) {
    const old = previous?.agents.get(id)
    next.agents.set(id, { ...agent, opacity: 1, scale: 1,
      ...(old ? { x: old.x, y: old.y, pinned: old.pinned } : {}) })
  }
  for (const [id, tool] of next.toolCalls) {
    const old = previous?.toolCalls.get(id)
    next.toolCalls.set(id, { ...tool, opacity: 1, ...(old ? { x: old.x, y: old.y } : {}) })
  }
  next.edges = next.edges.map(edge => ({ ...edge, opacity: 1 }))
  next.particles = []
  next.currentTime = Number.isFinite(targetTime) ? targetTime : next.maxTimeReached
  return next
}
