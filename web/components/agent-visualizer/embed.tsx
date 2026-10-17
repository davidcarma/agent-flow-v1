"use client"

/**
 * pjan.ai iframe embed: one session via EventSource / JSON poll.
 * No VS Code bridge. Session filter drops other sessions' events.
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

type EmbedProps = {
  sessionId: string | null
  eventsUrl: string | null
  metaUrl?: string | null
}

export function EmbedVisualizer({ sessionId, eventsUrl, metaUrl }: EmbedProps) {
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
      const key = `${raw.sessionId || ''}:${raw.type}:${Number(raw.time) || 0}:${JSON.stringify(raw.payload || {}).slice(0, 160)}`
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
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || data.source !== 'pjan:agent-flow' || data.type !== 'events') return
      if (sessionId && data.sessionId && data.sessionId !== sessionId) return
      const events = Array.isArray(data.events) ? data.events : []
      ingest(events)
      setStatusLabel(`postMessage · ${sessionId || 'session'}`)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sessionId, ingest])

  useEffect(() => {
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
  }, [eventsUrl, metaUrl, sessionId, ingest])

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
  })

  const selection = useSelectionState({ agents, toolCalls, discoveries })

  useEffect(() => {
    const timer = setTimeout(() => play(), TIMING.autoPlayDelayMs)
    return () => clearTimeout(timer)
  }, [play])

  const selectedAgent = selection.selectedAgentId
    ? agents.get(selection.selectedAgentId) || null
    : null
  const selectedConversation = selectedAgent
    ? conversations.get(selectedAgent.name) || []
    : []

  const handlePlayPause = useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, pause, play])

  const timelineEvents = useMemo(() => [], [])

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
          selectedAgentId={selection.selectedAgentId}
          hoveredAgentId={selection.hoveredAgentId}
          showStats={false}
          showHexGrid
          zoomToFitTrigger={0}
          pauseAutoFit={false}
          onAgentClick={selection.handleAgentClick}
          onAgentHover={selection.setHoveredAgentId}
          onAgentDrag={updateAgentPosition}
          onContextMenu={selection.handleContextMenu}
          onToolCallClick={selection.handleToolCallClick}
          selectedToolCallId={selection.selectedToolCallId}
          onDiscoveryClick={selection.handleDiscoveryClick}
          selectedDiscoveryId={selection.selectedDiscoveryId}
          showCostOverlay={showCostOverlay}
        />

        <MessageFeedPanel
          conversations={conversations}
          agents={agents}
          onAgentClick={selection.handleAgentClick}
          selectedAgentId={selection.selectedAgentId}
        />

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
          onRestart={restart}
          onSpeedChange={setSpeed}
          onSeek={seekToTime}
          timelineEvents={timelineEvents}
          eventCount={pending.length}
          onEnterReview={() => setShowCostOverlay((v) => !v)}
          isReviewing={false}
        />
      </div>
    </OpenFileProvider>
  )
}
