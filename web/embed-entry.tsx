import { createRoot } from 'react-dom/client'
import { EmbedVisualizer } from './components/agent-visualizer/embed'
import './app/globals.css'

function readBootstrap() {
  const params = new URLSearchParams(window.location.search)
  const sessionId = String(params.get('sessionId') || '').trim()
  const eventsUrl = String(params.get('eventsUrl') || '').trim()
  const metaUrl = String(params.get('metaUrl') || '').trim()
  return { sessionId, eventsUrl, metaUrl, hostManaged: params.get('host') === '1' }
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

const bootstrap = readBootstrap()
const root = createRoot(rootElement)
root.render(
  <EmbedVisualizer
    sessionId={bootstrap.sessionId || null}
    eventsUrl={bootstrap.eventsUrl || null}
    metaUrl={bootstrap.metaUrl || null}
    hostManaged={bootstrap.hostManaged}
  />,
)
