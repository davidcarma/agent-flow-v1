import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { acceptsHostMessage, replayEmbedSnapshot, terminalSnapshot } from './embed-snapshot'
import { pjanAgentState, type ProcessEventContext } from './process-event'
import { computeNextFrame } from './animate'
import { wrapText } from '../../components/agent-visualizer/canvas/draw-bubbles'
import type { SimulationEvent } from '../../lib/agent-types'

const ctx: ProcessEventContext = { syncForceSimulation() {}, findToolSlot: () => ({ x: 100, y: 100 }), getContextWindowSize: () => 200000, blockIdCounter: { current: 0 }, skipForceSync: true, embedMode: true }
const event = (eventId: string, type: SimulationEvent['type'], payload: Record<string, unknown>, time = 0): SimulationEvent => ({ eventId, type, payload, time, sessionId: 'proof' })

test('host messages require parent identity, same origin and exact present session', () => {
  const parent = {} as Window
  const data = { source: 'pjan:agent-flow', type: 'snapshot', sessionId: 'proof' }
  const message = { origin: 'https://pjan.test', source: parent, data }
  assert.equal(acceptsHostMessage(message, message.origin, parent, 'proof'), true)
  assert.equal(acceptsHostMessage({ ...message, source: {} as Window }, message.origin, parent, 'proof'), false)
  assert.equal(acceptsHostMessage({ ...message, origin: 'https://foreign.test' }, message.origin, parent, 'proof'), false)
  assert.equal(acceptsHostMessage({ ...message, data: { ...data, sessionId: undefined } }, message.origin, parent, 'proof'), false)
  assert.equal(acceptsHostMessage(message, message.origin, parent, 'other'), false)
})

test('full replacement updates long metadata, removes obsolete nodes and preserves positions', () => {
  const long = 'x'.repeat(500)
  const first = event('desk', 'pjan_desk', { name: 'desk', status: 'running', detail: { body: long, tail: 'old' } })
  let state = replayEmbedSnapshot([first, first, event('obsolete', 'pjan_stage', { name: 'obsolete' })], 'proof', ctx)
  state.agents.set('desk', { ...state.agents.get('desk')!, x: 987, y: 654, pinned: true })
  const changed = event('desk', 'pjan_desk', { name: 'desk', status: 'failed', detail: { body: long, tail: 'new' } })
  state = replayEmbedSnapshot([changed, changed], 'proof', ctx, state)
  assert.equal(state.agents.size, 1)
  assert.equal(state.eventLog.length, 1)
  assert.equal(state.agents.get('desk')?.state, 'error')
  assert.equal((state.agents.get('desk')?.detail as { tail: string }).tail, 'new')
  assert.equal(state.agents.get('desk')?.x, 987)
  assert.equal(state.agents.get('desk')?.pinned, true)
  assert.equal(state.agents.get('desk')?.messageBubbles.length, 0)
})

test('large unbroken and over-indented bubble text always progresses with bounded measurements', () => {
  let measurements = 0
  const context = { font: 'test', measureText(text: string) { measurements++; return { width: text.length * 7 } } } as CanvasRenderingContext2D
  const input = ' '.repeat(100) + 'x'.repeat(20000)
  const lines = wrapText(context, input, 140)
  assert.equal(lines.join(''), input)
  assert.ok(lines.every(line => line.length <= 20))
  assert.ok(measurements < 20000, `measurements=${measurements}`)
})

test('explicit call ids retain parallel calls and match out-of-order ends only once', () => {
  const events = [event('root', 'agent_spawn', { name: 'root' }),
    event('a', 'tool_call_start', { agent: 'root', tool: 'retrieve', callId: 'a' }, 1),
    event('b', 'tool_call_start', { agent: 'root', tool: 'retrieve', callId: 'b' }, 1.1),
    event('endb', 'tool_call_end', { agent: 'root', tool: 'retrieve', callId: 'b', result: 'B', isError: true }, 2),
    event('unknown', 'tool_call_end', { agent: 'root', tool: 'retrieve', callId: 'foreign', result: 'bad' }, 3),
    event('enda', 'tool_call_end', { agent: 'root', tool: 'retrieve', callId: 'a', result: 'A' }, 4)]
  const state = replayEmbedSnapshot(events, 'proof', ctx)
  assert.equal(state.toolCalls.size, 2)
  assert.equal(state.agents.get('root')?.toolCalls, 2)
  assert.equal(state.toolCalls.get('tool-root-b')?.state, 'error')
  assert.equal(state.toolCalls.get('tool-root-b')?.result, 'B')
  assert.equal(state.toolCalls.get('tool-root-a')?.result, 'A')
})

test('parent completion never rewrites failed children or unfinished tool outcomes', () => {
  const state = replayEmbedSnapshot([
    event('root', 'agent_spawn', { name: 'root' }),
    event('child', 'pjan_stage', { name: 'child', parent: 'root', status: 'failed' }),
    event('call', 'tool_call_start', { agent: 'root', tool: 'retrieve', callId: 'waiting' }, 1),
    event('done', 'agent_complete', { name: 'root' }, 2),
  ], 'proof', ctx)
  assert.equal(state.agents.get('child')?.state, 'error')
  assert.equal(state.toolCalls.get('tool-root-waiting')?.state, 'running')
  const frame = computeNextFrame(state, 1000, 1002, 1002, state, { useMockData: false, mockScenarioLength: 0, mockScenarioEndTime: 0, retainEntities: true })
  assert.equal(frame.agents.size, 2)
  assert.equal(frame.agents.get('root')?.opacity, 1)
  assert.equal(frame.toolCalls.size, 1)
  assert.equal(frame.toolCalls.get('tool-root-waiting')?.opacity, 1)
})

test('truthful status mapping and host transport guard', () => {
  assert.equal(pjanAgentState('running'), 'thinking')
  assert.equal(pjanAgentState('failed'), 'error')
  assert.equal(pjanAgentState('skipped'), 'paused')
  assert.equal(pjanAgentState('pending'), 'idle')
  assert.equal(terminalSnapshot({ summary: { status: 'done' } } as never), true)
  const source = readFileSync(new URL('../../components/agent-visualizer/embed.tsx', import.meta.url), 'utf8')
  assert.match(source, /if \(hostManaged\) return\s+if \(!eventsUrl\)/)
  assert.match(source, /type: 'ready', sessionId/)
  assert.doesNotMatch(source, /JSON\.stringify\([^\n]+\.slice\(0, 160\)/)
})
