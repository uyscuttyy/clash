import { createApp } from './app'
import { Repository } from './repository'

const port = Number(process.env.PORT || 8787)
const app = createApp(new Repository(), { startSync: true })
const server = app.listen(port, () => console.log(`CLASH marketplace API listening on http://localhost:${port}`))

// Graceful shutdown so the background sync timer releases cleanly.
function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down.`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
