import { defineConfig } from 'tsdown'
import { pulseClientBundle } from './scripts/tsdown.client.ts'

export default defineConfig(pulseClientBundle('dsh-pulse', 'src/client/index.ts'))
