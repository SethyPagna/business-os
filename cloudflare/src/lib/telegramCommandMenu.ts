import { configureTelegramWebhook, telegramMenuSettings } from './telegram'
import { TELEGRAM_COMMANDS } from './telegramLang'
import type { Env } from '../index'

export type MenuRole = 'alerts' | 'alerts_admins' | 'other_chat' | 'cleanup'
type BotCommand = { command: string; description: string }
type BotCommandScope =
  | { type: 'chat' | 'chat_administrators'; chat_id: string }
  | { type: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators' }
export type MenuCall =
  | { role: MenuRole; method: 'setMyCommands'; body: { scope: BotCommandScope; commands: BotCommand[] } }
  | { role: 'cleanup'; method: 'deleteMyCommands'; body: { scope: BotCommandScope } }
export type MenuResult = { menu: 'ok' | 'partial' | 'failed'; failed: MenuRole[] }

type CommandDoc = typeof TELEGRAM_COMMANDS[number]
export type MenuPlanInput = { alertsChatId: string; chatIds: readonly string[]; describe: (doc: CommandDoc) => string }

const MAX_OTHER_CHATS = 10
const MENU_CALL_TIMEOUT_MS = 8000
// Both answer only in the alerts chat (telegram.ts topicCommandReply), and /settopic saves only for a
// group admin, which a private chat has none of.
const SETTOPIC = '/settopic'
const TOPICS = '/topics'
const CLEANUP_SCOPES = ['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators'] as const

const botCommands = (docs: readonly CommandDoc[], describe: MenuPlanInput['describe']): BotCommand[] =>
  docs.map((doc) => ({ command: doc.command.replace(/^\//, ''), description: describe(doc) }))

/**
 * The Bot API calls that give each approved chat its menu. A scope REPLACES the lists below it, so
 * the administrators' list carries every command, not just the extra one. The cleanup deletes run
 * last: an unapproved chat then shows no menu at all.
 */
export function commandMenuPlan({ alertsChatId, chatIds, describe }: MenuPlanInput): MenuCall[] {
  const members = TELEGRAM_COMMANDS.filter((doc) => doc.command !== SETTOPIC)
  const elsewhere = members.filter((doc) => doc.command !== TOPICS)
  const alertsIsGroup = alertsChatId.startsWith('-')
  const others = [...new Set(chatIds)].filter((id) => id !== alertsChatId).slice(0, MAX_OTHER_CHATS)
  return [
    { role: 'alerts', method: 'setMyCommands', body: { scope: { type: 'chat', chat_id: alertsChatId }, commands: botCommands(members, describe) } },
    ...(alertsIsGroup
      ? [{ role: 'alerts_admins', method: 'setMyCommands', body: { scope: { type: 'chat_administrators', chat_id: alertsChatId }, commands: botCommands(TELEGRAM_COMMANDS, describe) } } as MenuCall]
      : []),
    ...others.map((chatId): MenuCall => ({ role: 'other_chat', method: 'setMyCommands', body: { scope: { type: 'chat', chat_id: chatId }, commands: botCommands(elsewhere, describe) } })),
    ...CLEANUP_SCOPES.map((type): MenuCall => ({ role: 'cleanup', method: 'deleteMyCommands', body: { scope: { type } } })),
  ]
}

async function callSucceeded(token: string, call: MenuCall): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${call.method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(MENU_CALL_TIMEOUT_MS),
    })
    if (!response.ok) return false
    const result = await response.json<{ ok?: boolean }>().catch(() => null)
    return result?.ok === true
  } catch {
    return false
  }
}

const MENU_BROKEN: ReadonlySet<MenuRole> = new Set(['alerts', 'alerts_admins'])

/** Every scope is tried; the old menus are removed only once the alerts chat has its new one. */
export async function runCommandMenu(token: string, plan: readonly MenuCall[]): Promise<MenuResult> {
  const failed = new Set<MenuRole>()
  for (const call of plan.filter((entry) => entry.role !== 'cleanup')) {
    if (!(await callSucceeded(token, call))) failed.add(call.role)
  }
  const broken = [...failed].some((role) => MENU_BROKEN.has(role))
  if (!broken) {
    for (const call of plan.filter((entry) => entry.role === 'cleanup')) {
      if (!(await callSucceeded(token, call))) failed.add(call.role)
    }
  }
  return { menu: broken ? 'failed' : failed.size ? 'partial' : 'ok', failed: [...failed] }
}

export async function registerTelegramCommandMenu(env: Env): Promise<MenuResult> {
  const settings = await telegramMenuSettings(env)
  return runCommandMenu(settings.token, commandMenuPlan(settings))
}

/** POST /connect-commands: the webhook first (a menu for commands nobody receives would mislead). */
export async function connectTelegramCommands(env: Env): Promise<MenuResult> {
  await configureTelegramWebhook(env)
  return registerTelegramCommandMenu(env)
}
