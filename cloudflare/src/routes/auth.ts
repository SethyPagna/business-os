import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { getDb } from '../lib/db'
import { createSession, setSessionCookie, clearSessionCookie, getSessionUser, revokeSession } from '../lib/auth'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()

app.post('/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string; sessionDuration?: string; deviceName?: string }>()
  if (!body.username || !body.password) {
    return c.json({ error: 'Username and password are required' }, 400)
  }

  const db = getDb(c.env)
  const user = await db.prepare(`
    SELECT id, username, name, password, organization_id, role_id, permissions, is_active
    FROM users
    WHERE lower(username) = lower(@username) AND deleted_at IS NULL
    LIMIT 1
  `).get<{ id: number; username: string; name: string; password: string; organization_id: number | null; role_id: number | null; permissions: string; is_active: number }>({ username: body.username })

  // Same response whether the user doesn't exist or the password is wrong --
  // ported deliberately from the original, which avoids confirming which
  // usernames exist via response differences (a real, if minor, security
  // property worth keeping even in this scoped-down port).
  const invalidCredentials = () => c.json({ error: 'Invalid username or password' }, 401)

  if (!user || !user.is_active) return invalidCredentials()
  const passwordMatches = bcrypt.compareSync(body.password, user.password)
  if (!passwordMatches) return invalidCredentials()

  const session = await createSession(c.env, user.id, {
    sessionDuration: body.sessionDuration,
    deviceName: body.deviceName,
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip') || undefined,
  })
  setSessionCookie(c, session.token, session.expiresAt)

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      organizationId: user.organization_id,
      roleId: user.role_id,
      permissions: user.permissions,
    },
    sessionExpiresAt: session.expiresAt,
  })
})

app.post('/logout', async (c) => {
  await revokeSession(c)
  clearSessionCookie(c)
  return c.json({ ok: true })
})

app.get('/me', async (c) => {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  return c.json({ user })
})

export default app
