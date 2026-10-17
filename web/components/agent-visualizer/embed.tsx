"use client"

/**
 * pjan.ai iframe embed: strict host snapshots, or legacy EventSource / JSON.
 * host=1 performs no network I/O. Native canvas and controls remain available.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentSimulation } from '@/hooks/use-agent-simulation'
import { useSelectionState } from '@/hooks/use-selection-state'
import { AgentCanvas } from './canvas'
import { ControlBar } from './control-bar'
import { AgentDetailCard } from './agent-detail-card'
import { AgentChatPanel } from './chat-panel'
import { MessageFeedPanel } from './message-feed-panel'
import { OpenFileProvider } from './tool-content-renderer'
import { stopPropagationHandlers } from './shared-ui'
import type { SimulationEvent } from '@/lib/agent-types'
import { TIMING } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { acceptsHostMessage, terminalSnapshot, type EmbedSnapshot } from '@/hooks/simulation/embed-snapshot'

type EmbedProps = {
  sessionId: string | null
  eventsUrl: string | null
  metaUrl?: string | null
  hostManaged?: boolean
}

export function EmbedVisualizer({ sessionId, eventsUrl, metaUrl, hostManaged = false }: EmbedProps) {
  const [snapshot, setSnapshot] = useState<EmbedSnapshot | null>(null)
  const [visible, setVisible] = useState(true)
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)
  const [filter, setFilter] = useState('')
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const revisionRef = useRef<number | string | null>(null)
  const emptyEvents = useMemo<SimulationEvent[]>(() => [], [])
  const [pending, setPending] = useState<SimulationEvent[]>([])
  const [statusLabel, setStatusLabel] = useState('waiting')
  const [showCostOverlay, setShowCostOverlay] = useState(false)
  const seenIds = useRef(new Set<string>())
  const sessionFilterRef = useRef(sessionId)

  useEffect(() => {
    sessionFilterRef.current = sessionId
  }, [sessionId])

  const ingest = useCallback((batch: SimulationEvent[]) => {
    if (!Array.isArray(batch) || !batch.length) return
    const filter = sessionFilterRef.current
    const next: SimulationEvent[] = []
    for (const raw of batch) {
      if (!raw || typeof raw !== 'object') continue
      if (filter && raw.sessionId && raw.sessionId !== filter) continue
      const key = raw.eventId || JSON.stringify(raw)
      if (seenIds.current.has(key)) continue
      seenIds.current.add(key)
      next.push({ ...raw, sessionId: raw.sessionId || filter || undefined })
    }
    if (next.length) setPending((prev) => prev.concat(next))
  }, [])

  const consumeEvents = useCallback(() => {
    setPending([])
  }, [])

  // Host panel fallback when Agent Flow API routes are not yet loaded in the running process.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!acceptsHostMessage(event, window.location.origin, window.parent, sessionId)) return
      const data = event.data
      if (data.type === 'visibility' && typeof data.visible === 'boolean') {
        setVisible(data.visible)
        return
      }
      if (data.type === 'snapshot' && Array.isArray(data.events)) {
        if (data.revision === revisionRef.current) return
        if (typeof data.revision === 'number' && typeof revisionRef.current === 'number' && data.revision < revisionRef.current) return
        revisionRef.current = data.revision
        setSnapshot({ ...data, inventory: Array.isArray(data.inventory) ? data.inventory : [], summary: data.summary || {} })
        setStatusLabel(`snapshot ${data.revision} · ${data.summary?.status || 'waiting'}`)
        return
      }
      if (!hostManaged && data.type === 'events') ingest(Array.isArray(data.events) ? data.events : [])
    }
    window.addEventListener('message', onMessage)
    if (sessionId) window.parent.postMessage({ source: 'agent-flow:embed', type: 'ready', sessionId }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [sessionId, ingest, hostManaged])

  useEffect(() => {
    const changed = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])

  useEffect(() => {
    if (hostManaged) return
    if (!eventsUrl) {
      setStatusLabel(sessionId ? 'no eventsUrl' : 'missing sessionId')
      return undefined
    }
    let closed = false
    let es: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    async function pullOnce() {
      try {
        const res = await fetch(eventsUrl!, { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('text/event-stream')) return
        const body = await res.json()
        const events = Array.isArray(body?.events) ? body.events : (Array.isArray(body) ? body : [])
        if (!closed) {
          ingest(events)
          setStatusLabel(`poll · ${sessionId || 'session'}`)
        }
      } catch (err) {
        if (!closed) setStatusLabel(`poll error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    try {
      es = new EventSource(eventsUrl)
      es.onopen = () => { if (!closed) setStatusLabel(`sse · ${sessionId || 'session'}`) }
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data)
          const events = Array.isArray(data?.events) ? data.events : (data?.type ? [data] : [])
          ingest(events)
        } catch {
          /* ignore */
        }
      }
      es.addEventListener('agent-flow', (msg) => {
        try {
          const data = JSON.parse((msg as MessageEvent).data)
          const events = Array.isArray(data?.events) ? data.events : (data?.type ? [data] : [])
          ingest(events)
        } catch {
          /* ignore */
        }
      })
      es.onerror = () => {
        es?.close()
        es = null
        void pullOnce()
        pollTimer = setInterval(() => { void pullOnce() }, 2500)
      }
    } catch {
      void pullOnce()
      pollTimer = setInterval(() => { void pullOnce() }, 2500)
    }

    if (metaUrl) {
      void fetch(metaUrl, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((meta) => {
          if (!closed && meta?.status) setStatusLabel(String(meta.status))
        })
        .catch(() => undefined)
    }

    return () => {
      closed = true
      es?.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [eventsUrl, metaUrl, sessionId, ingest, hostManaged])

  const {
    frameRef,
    agents,
    toolCalls,
    particles,
    edges,
    discoveries,
    fileAttention,
    currentTime,
    isPlaying,
    speed,
    maxTimeReached,
    conversations,
    play,
    pause,
    restart,
    setSpeed,
    seekToTime,
    updateAgentPosition,
  } = useAgentSimulation({
    useMockData: false,
    externalEvents: pending,
    onExternalEventsConsumed: consumeEvents,
    sessionFilter: sessionId,
    sessionFilterRef,
    snapshotEvents: hostManaged || snapshot ? snapshot?.events || emptyEvents : undefined,
    snapshotTerminal: terminalSnapshot(snapshot),
  })

  const selection = useSelectionState({ agents, toolCalls, discoveries })

  useEffect(() => {
    if (hostManaged) return
    const timer = setTimeout(() => play(), TIMING.autoPlayDelayMs)
    return () => clearTimeout(timer)
  }, [play, hostManaged])

  useEffect(() => {
    if (!visible || !documentVisible) pause()
  }, [visible, documentVisible, pause, isPlaying])

  const selectedAgent = selection.selectedAgentId
    ? agents.get(selection.selectedAgentId) || null
    : null
  const selectedConversation = selectedAgent
    ? conversations.get(selectedAgent.name) || []
    : []

  const handlePlayPause = useCallback(() => {
    if (isPlaying) pause()
    else if (visible && documentVisible) play()
  }, [isPlaying, pause, play, visible, documentVisible])

  const timelineEvents = useMemo(() => [], [])
  const inventory = snapshot?.inventory || []
  const selectedNativeId = selection.selectedToolCallId || selection.selectedAgentId
  const selectedTool = selection.selectedToolCallId ? toolCalls.get(selection.selectedToolCallId) : null
  const inspected = inventory.find(item => item.id === (inspectedId || selectedTool?.callId || selectedNativeId))
    || (selectedTool ? { id: selectedTool.id, kind: 'tool', label: selectedTool.toolName, status: selectedTool.state, detail: selectedTool } : null)
    || (selectedAgent ? { id: selectedAgent.id, kind: 'agent', label: selectedAgent.name, status: selectedAgent.sourceStatus || selectedAgent.state, detail: selectedAgent.detail || selectedAgent } : null)
  const selectEntity = (id: string | null) => {
    setInspectedId(id)
    if (id && agents.has(id)) selection.handleAgentClick(id)
  }
  const summary = snapshot?.summary

  if (!sessionId) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: COLORS.void }}>
        <div className="text-sm font-mono" style={{ color: '#66ccff80' }}>Agent Flow embed needs sessionId</div>
      </div>
    )
  }

  const isEmpty = agents.size === 0

  return (
    <OpenFileProvider value={null}>
      <div className="h-screen w-screen relative overflow-hidden" style={{ background: COLORS.void }}>
        <div
          className="absolute top-2 left-2 z-20 px-2 py-1 rounded text-[10px] font-mono"
          style={{ background: 'rgba(8,12,22,0.85)', color: '#8fa3bf', border: '1px solid rgba(56,189,248,0.25)' }}
        >
          pjan · {sessionId.slice(0, 16)} · {statusLabel}
          {summary && <div data-testid="embed-summary" className="mt-1 text-xs">Tools {summary.toolCount ?? 0} · LLM {summary.llmCount ?? 0} · Tokens {summary.tokens ?? 0} · Cost ${Number(summary.costUsd || 0).toFixed(4)} · Evidence {summary.evidenceCount ?? 0}</div>}
        </div>

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center font-mono">
              <div className="text-sm" style={{ color: '#66ccff80' }}>WAITING FOR SESSION TELEMETRY</div>
              <div className="mt-2 text-xs" style={{ color: '#66ccff40' }}>{sessionId}</div>
            </div>
          </div>
        )}

        <AgentCanvas
          simulationRef={frameRef}
          animationEnabled={visible && documentVisible && isPlaying}
          suspendRendering={!visible || !documentVisible}
          selectedAgentId={selection.selectedAgentId}
          hoveredAgentId={selection.hoveredAgentId}
          showStats={false}
          showHexGrid
          zoomToFitTrigger={0}
          pauseAutoFit={false}
          onAgentClick={(id) => { setInspectedId(null); selection.handleAgentClick(id) }}
          onAgentHover={selection.setHoveredAgentId}
          onAgentDrag={updateAgentPosition}
          onContextMenu={selection.handleContextMenu}
          onToolCallClick={(id) => { setInspectedId(null); selection.handleToolCallClick(id) }}
          selectedToolCallId={selection.selectedToolCallId}
          onDiscoveryClick={selection.handleDiscoveryClick}
          selectedDiscoveryId={selection.selectedDiscoveryId}
          showCostOverlay={showCostOverlay}
        />

        {snapshot && <aside aria-label="Session inventory" className="absolute right-2 top-2 bottom-20 z-30 flex flex-col rounded border text-xs" style={{ width: 'min(360px, 45vw)', background: 'rgba(8,12,24,.95)', borderColor: '#334155', color: '#d1e4f4' }} {...stopPropagationHandlers}>
          <div className="p-2 font-mono">Session inventory ({inventory.length})</div>
          <input aria-label="Filter inventory" placeholder="Filter entities" value={filter} onChange={e => setFilter(e.target.value)} className="mx-2 p-2 rounded bg-slate-900 border border-slate-700" />
          <div className="overflow-auto p-2" style={{ maxHeight: inspected ? '35%' : '85%' }}>
            {inventory.filter(item => `${item.kind} ${item.label} ${item.status} ${item.id}`.toLowerCase().includes(filter.toLowerCase())).map(item => <button key={item.id} className="block w-full text-left p-2 rounded hover:bg-slate-800" style={{ background: inspected?.id === item.id ? '#1e293b' : undefined }} onClick={() => selectEntity(item.id)}><span className="text-sky-300">{item.kind}</span> · {item.label}<div className="text-slate-400">{item.status || 'pending'}</div></button>)}
          </div>
          {inspected && <section aria-label="Entity details" className="border-t border-slate-700 p-2 overflow-auto flex-1 min-h-0">
            <div className="font-bold">{inspected.label} · {inspected.status}</div>
            <pre className="mt-2 whitespace-pre-wrap break-words select-text" style={{ overflowWrap: 'anywhere' }}>{JSON.stringify(inspected, null, 2)}</pre>
          </section>}
        </aside>}

        {!snapshot && <MessageFeedPanel
          conversations={conversations}
          agents={agents}
          onAgentClick={(id) => { setInspectedId(null); selection.handleAgentClick(id) }}
          selectedAgentId={selection.selectedAgentId}
        />}

        {selectedAgent && selection.selectedAgentWorldPos && (
          <div {...stopPropagationHandlers}>
            <AgentDetailCard agent={selectedAgent} onClose={selection.clearAgent} />
          </div>
        )}

        <AgentChatPanel
          visible={!!selectedAgent}
          agentName={selectedAgent?.name ?? ''}
          agentState={selectedAgent?.state ?? 'idle'}
          conversation={selectedConversation}
          runtime={selectedAgent?.runtime ?? 'codex'}
          onClose={selection.clearAgent}
        />

        <ControlBar
          isPlaying={isPlaying}
          speed={speed}
          currentTime={currentTime}
          totalDuration={Math.max(maxTimeReached, currentTime)}
          onPlayPause={handlePlayPause}
          onRestart={() => { if (visible && documentVisible) restart() }}
          onSpeedChange={setSpeed}
          onSeek={seekToTime}
          timelineEvents={timelineEvents}
          eventCount={snapshot?.events.length ?? pending.length}
          onEnterReview={() => setShowCostOverlay((v) => !v)}
          isReviewing={false}
        />
      </div>
    </OpenFileProvider>
  )
}
