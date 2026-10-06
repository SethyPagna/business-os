import { Hono } from 'hono'
import type { Env } from '../index'
import { BRANCH_CUTOVER_OPERATOR_ACTIONS, BRANCH_CUTOVER_OPERATOR_TOKEN_HEADER, branchCutoverOperatorEnabled, operatorTokenMatches,
  parseOperatorBody, runBranchCutoverOperatorAction, type BranchCutoverOperatorAction } from '../lib/branchCutoverOperator'

const route = new Hono<{ Bindings: Env }>()

route.post('/:action', async (c) => {
  const action = c.req.param('action') as BranchCutoverOperatorAction
  const respond = (status: number, body: Record<string, unknown>) => c.json(body, status as 200, { 'Cache-Control': 'no-store' })
  const configured = c.env.BRANCH_CUTOVER_OPERATOR_TOKEN
  if (!branchCutoverOperatorEnabled(configured) || !BRANCH_CUTOVER_OPERATOR_ACTIONS.includes(action)) return respond(404, { ok: false, code: 'not_found' })
  if (!await operatorTokenMatches(configured, c.req.header(BRANCH_CUTOVER_OPERATOR_TOKEN_HEADER))) return respond(401, { ok: false, code: 'unauthorized' })
  const body = parseOperatorBody(await c.req.text())
  if (!body) return respond(400, { ok: false, code: 'bad_request' })
  const outcome = await runBranchCutoverOperatorAction(c.env, action, body)
  return respond(outcome.status, outcome.body)
})

export default route
