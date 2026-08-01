import { Router } from 'express'
import { requestBuild, buildState, buildStats } from '../build/runner.js'
import { requireAuth } from '../auth.js'

export function buildRoutes() {
  const router = Router()

  router.post('/api/build', requireAuth('editor'), (req, res) => {
    requestBuild('manual rebuild')
    res.status(202).json({ ...buildState, state: 'building' })
  })

  router.get('/api/build/status', (req, res) => res.json({ ...buildState, ...buildStats }))

  return router
}
