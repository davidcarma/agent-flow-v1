import { defineConfig } from 'vite'
import { createBuildConfig } from './vite.config.shared'

/** Same-origin iframe build for pjan.ai session windows. */
export default defineConfig(createBuildConfig({
  outDir: '../dist/embed',
  entry: 'embed-entry.tsx',
  name: 'AgentFlowEmbed',
  define: {
    'process.env.NEXT_PUBLIC_DEMO': '"0"',
    'process.env.NEXT_PUBLIC_RELAY_PORT': '""',
    'process.env.AGENT_FLOW_STANDALONE': '"1"',
    'process.env.AGENT_FLOW_EMBED': '"1"',
  },
}))
