import assert from 'node:assert/strict'
import test from 'node:test'
import { toolCardLines } from './draw-tool-calls'

test('vault search cards split operation and first 20 parameter characters', () => {
  assert.deepEqual(toolCardLines({ toolName: 'vault_search', args: '{"path":"/vault/practice/domains/hvac"' }), [
    'vault_search',
    '{"path":"/vault/prac',
  ])
})

test('other tool cards retain their existing one-line label', () => {
  assert.deepEqual(toolCardLines({ toolName: 'virtual_file_read', args: '{"id":"skill"}' }), [
    'virtual_file_read: {"id":"skill"}',
    null,
  ])
})
