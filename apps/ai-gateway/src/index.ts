import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import dotenv from 'dotenv'
import { buildServer } from './server.js'
import { log } from './utils/logger.js'

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env')
]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
}

const { app, env, persistence } = await buildServer()

await app.listen({ port: env.port, host: '0.0.0.0' })
log.info('storyteller_ai_gateway_listening', {
  port: env.port,
  nodeEnv: env.nodeEnv,
  persistence
})
