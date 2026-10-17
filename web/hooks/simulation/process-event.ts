import {
  Agent,
  ToolCallNode,
  Edge,
  SimulationEvent,
  type TimelineEntry,
  type TimelineBlock,
} from '@/lib/agent-types'
import type { SimulationState, ConversationMessage } from './types'
import { handleAgentSpawn, handleAgentComplete, handleAgentIdle, handlePermissionRequested, handleModelDetected } from './handle-agent-events'
import { handleToolCallStart, handleToolCallEnd } from './handle-tool-events'
import { handleMessage, handleContextUpdate } from './handle-message-events'
import { handleSubagentDispatch, handleSubagentReturn } from './handle-subagent-events'

export interface ProcessEventContext {
  syncForceSimulation: (agents: Map<string, Agent>, edges: Edge[]) => void
  findToolSlot: (agent: Agent, agents: Map<string, Agent>, toolCalls: Map<string, ToolCallNode>, currentTime: number) => { x: number; y: number }
  getContextWindowSize: (modelId?: string) => number
  blockIdCounter: { current: number }
  skipForceSync: boolean
}

/** Mutable collections that handlers mutate in place during a single processEvent call. */
export interface MutableEventState {
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
  particles: SimulationState['particles']
  edges: Edge[]
  discoveries: SimulationState['discoveries']
  fileAttention: SimulationState['fileAttention']
  timelineEntries: SimulationState['timelineEntries']
  conversations: Map<string, ConversationMessage[]>
}

/** Close the last open block on a timeline entry and push a new one. */
export function pushTimelineBlock(
  entry: TimelineEntry,
  currentTime: number,
  block: Pick<TimelineBlock, 'type' | 'label' | 'color'> & { endTime?: number },
  ctx: ProcessEventContext,
): void {
  const lastBlock = entry.blocks[entry.blocks.length - 1]
  if (lastBlock && !lastBlock.endTime) lastBlock.endTime = currentTime
  entry.blocks.push({
    id: `block-${ctx.blockIdCounter.current++}`,
    type: block.type,
    startTime: currentTime,
    endTime: block.endTime,
    label: block.label,
    color: block.color,
  })
}

/** Shallow-compare two Maps by reference equality of values */
function mapsEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

export function processEvent(event: SimulationEvent, prev: SimulationState, ctx: ProcessEventContext): SimulationState {
      const state: MutableEventState = {
        agents: new Map(prev.agents),
        toolCalls: new Map(prev.toolCalls),
        particles: [...prev.particles],
        edges: [...prev.edges],
        discoveries: [...prev.discoveries],
        fileAttention: new Map(prev.fileAttention),
        timelineEntries: new Map(prev.timelineEntries),
        conversations: new Map(prev.conversations),
      }

      // pjan session entities render as Agent Flow agents / messages / context.
      const type = event.type
      const payload = event.payload || {}
      switch (type) {
        case 'pjan_desk':
        case 'pjan_stage':
        case 'pjan_letter':
        case 'pjan_pin':
        case 'pjan_document':
        case 'pjan_evidence_routes': {
          const name = String(payload.name || payload.label || type)
          handleAgentSpawn({
            name,
            isMain: type === 'pjan_letter' || type === 'pjan_desk',
            task: String(payload.purpose || payload.task || type),
            runtime: 'codex',
            parent: payload.parent || undefined,
          }, prev.currentTime, state, ctx)
          if (payload.status === 'succeeded' || payload.status === 'done' || payload.status === 'failed') {
            handleAgentComplete({ name }, prev.currentTime, state, ctx)
          }
          if (payload.detail || payload.message) {
            handleMessage({
              agent: name,
              role: 'assistant',
              content: String(payload.detail || payload.message),
            }, prev.currentTime, state)
          }
          break
        }
        case 'pjan_economics': {
          const agent = String(payload.agent || 'orchestrator')
          handleContextUpdate({
            agent,
            tokens: Number(payload.tokens) || 0,
            breakdown: payload.breakdown || {
              systemPrompt: 0,
              userMessages: 0,
              toolResults: 0,
              reasoning: 0,
              subagentResults: 0,
            },
          }, state)
          handleMessage({
            agent,
            role: 'assistant',
            content: String(payload.summary || `cost $${payload.costUsd ?? '-'} · ${payload.tokens ?? 0} tok`),
          }, prev.currentTime, state)
          break
        }
        case 'agent_spawn':       handleAgentSpawn(payload, prev.currentTime, state, ctx); break
        case 'agent_complete':    handleAgentComplete(payload, prev.currentTime, state, ctx); break
        case 'agent_idle':        handleAgentIdle(payload, state); break
        case 'model_detected':    handleModelDetected(payload, state, ctx); break
        case 'tool_call_start':   handleToolCallStart(payload, prev.currentTime, state, ctx); break
        case 'tool_call_end':     handleToolCallEnd(payload, prev.currentTime, state, ctx); break
        case 'message':           handleMessage(payload, prev.currentTime, state); break
        case 'context_update':    handleContextUpdate(payload, state); break
        case 'subagent_dispatch': handleSubagentDispatch(payload, prev.currentTime, state); break
        case 'subagent_return':   handleSubagentReturn(payload, prev.currentTime, state); break
        case 'permission_requested': handlePermissionRequested(payload, prev.currentTime, state, ctx); break
      }

      // Stabilize references for unchanged collections to prevent
      // downstream React useMemo/re-render cascades (O(n log n) sorts etc.)
      return {
        ...prev,
        agents: state.agents, toolCalls: state.toolCalls,
        particles: state.particles, edges: state.edges,
        discoveries: state.discoveries,
        fileAttention: mapsEqual(prev.fileAttention, state.fileAttention) ? prev.fileAttention : state.fileAttention,
        timelineEntries: mapsEqual(prev.timelineEntries, state.timelineEntries) ? prev.timelineEntries : state.timelineEntries,
        conversations: mapsEqual(prev.conversations, state.conversations) ? prev.conversations : state.conversations,
      }
}
