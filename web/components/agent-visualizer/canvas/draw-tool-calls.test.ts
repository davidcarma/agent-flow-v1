import assert from 'node:assert/strict'
import test from 'node:test'
import { toolArgumentValue, toolCardLines, vaultTarget } from './draw-tool-calls'

test('vault search cards show the note being read, not JSON boilerplate', () => {
  assert.deepEqual(toolCardLines({ toolName: 'vault_search', args: '{"path":"/vault/practice/methods/practice-limb-open.md"}' }), [
    'vault_search',
    'practice-limb-open',
  ])
  assert.deepEqual(toolCardLines({ toolName: 'vault_search', args: '{"path":"/vault/practice/domains/geotechnical-excavation/_index.md"}' }), [
    'vault_search',
    'geotechnical-excavation',
  ])
  assert.deepEqual(toolCardLines({ toolName: 'vault_search', args: '{"query":"practice limb open"}' }), [
    'vault_search',
    'practice limb open',
  ])
})

test('vault targets drop shared path noise but keep an unusual leaf', () => {
  assert.equal(vaultTarget('{"path":"/vault/GLOSSARY.md"}'), 'GLOSSARY')
  assert.equal(vaultTarget('{"path":"/vault/facts/enforcement-sanction-flow.md"}'), 'enforcement-sanction-flow')
  assert.equal(vaultTarget('{"path":"/vault/practice/domains/_index.md"}'), 'domains')
})

test('non-JSON arguments stay readable and other tools keep their one-line label', () => {
  assert.equal(toolArgumentValue('rg -n vault'), 'rg -n vault')
  assert.deepEqual(toolCardLines({ toolName: 'virtual_file_read', args: '{"id":"skill"}' }), [
    'virtual_file_read: {"id":"skill"}',
    null,
  ])
})
