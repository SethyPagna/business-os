import { useId, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Heart from 'lucide-react/dist/esm/icons/heart.js'
import Menu from 'lucide-react/dist/esm/icons/menu.js'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle.js'
import Moon from 'lucide-react/dist/esm/icons/moon.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Sun from 'lucide-react/dist/esm/icons/sun.js'
import User from 'lucide-react/dist/esm/icons/user.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import PortalContactMenu from './PortalContactMenu.tsx'
import { PortalContactRows } from './PortalSocialRow.tsx'
import { PORTAL_PRIMARY_COLORS } from './portalButtons.ts'
import type { PortalLanguageOption } from './portalLanguageOptions.ts'
import type { PortalContactEntry } from './portalSocialLinks.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string
type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>

/**
 * The storefront's one floating control (owner, 21 Nov 2026), fixed bottom-right. From 1888 px up (WIDE_DOCK_FROM) there is room BESIDE the content
 * for a stack of round 48 px buttons, top to bottom: Language, Theme, Account, Shop (List and Saved), Contact (a 128 px pill). Below that, at every
 * width, ONE round 56 px button opens a compact menu with the same things as rows, so the dock never covers a control. Nothing else sits in the
 * header row. The arithmetic: the page container is 1680 px wide with 56 px of padding, so beside the content there are (viewport - 1680) / 2 + 56 px;
 * the stack needs its 16 px offset + 128 px + 16 px of air = 160 px, which is reached at 1888 px (tests/storefrontFooterClearance.test.ts holds it).
 *
 * The dock sits under every sheet and dialog (z-[55] against the sheets' 60 and the lightbox's 90) and goes away while one is open
 * (`hidden`). It is never rendered by the Website Editor preview, which scrolls inside the admin shell.
 */
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5c22] dark:focus-visible:outline-[#d6b56b]'
const ROUND = `relative inline-flex shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-[#23201b] shadow-md transition hover:bg-stone-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800 ${FOCUS}`
const ROUND_WIDE = `${ROUND} h-12 w-12`
const ROUND_SMALL = `${ROUND} h-14 w-14`
const CONTACT_BUTTON = `inline-flex h-12 w-32 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-semibold shadow-md transition ${FOCUS} ${PORTAL_PRIMARY_COLORS}`
const COUNT_BADGE = 'notranslate absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-700 px-1 text-[11px] font-bold leading-none text-white'
const ROW = `flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-[#23201b] transition hover:bg-[#f6ece0] dark:text-neutral-100 dark:hover:bg-neutral-700 ${FOCUS}`
const ROW_ICON = 'h-4 w-4 shrink-0 text-[#7a5c22] dark:text-amber-300'

export type PortalDockProps = {
  copy: CopyFn
  darkMode: boolean
  /** A sheet, dialog or lightbox is open: the dock steps out of the way. */
  hidden?: boolean
  contactEntries: readonly PortalContactEntry[]
  onOpenAccount?: () => void
  accountSignedIn?: boolean
  /** The signed-in name, shown as the Account row's value on a phone. */
  accountName?: string
  onOpenList?: () => void
  onOpenWishlist?: () => void
  listCount?: number
  wishlistCount?: number
  /** 'viewport' (the live page): fixed bottom-right. 'frame' (the Website Editor preview): pinned to the bottom-right of the preview frame, the phone button only. */
  placement?: 'viewport' | 'frame'
  /** Off when the shop has switched the language tools off. */
  languageEnabled: boolean
  languageOptions: readonly PortalLanguageOption[]
  /** The active row of the language menu: one of the six values. */
  activeLanguage: string
  changePageLanguage: (language: string) => void
  toggleTheme: () => void
}

/** The six languages, the active one checked, and one short note line under them. Used by the wide Language button and the phone menu. */
export function LanguageOptions({ copy, options, active, onPick }: { copy: CopyFn; options: readonly PortalLanguageOption[]; active: string; onPick: (value: string) => void }) {
  const labelId = useId()
  return (
    <div className="w-60 max-w-[85vw] py-1" role="group" aria-labelledby={labelId} data-portal-language-menu="">
      <span id={labelId} className="sr-only">{copy('publicTranslation', 'Language tools')}</span>
      {options.map((option) => {
        const isActive = active === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-current={isActive ? 'true' : undefined}
            className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-sm transition hover:bg-stone-100 dark:hover:bg-neutral-800 ${isActive ? 'font-semibold text-[#7a5c22] dark:text-amber-300' : 'text-[#23201b] dark:text-neutral-200'}`}
            onClick={() => onPick(option.value)}
          >
            {/* Each label stays in its own script: a page translator must never rewrite it. */}
            <span translate="no" className="notranslate">{option.label}</span>
            <span className="flex items-center gap-2">
              {option.google ? (
                <span translate="no" className="notranslate rounded border border-stone-300 px-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-stone-500 dark:border-neutral-600 dark:text-neutral-400">Google</span>
              ) : null}
              {isActive ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
            </span>
          </button>
        )
      })}
      {/* Which languages Google writes and which are the shop's own text: a notice, not a control. */}
      <p data-portal-google-note="" className="mx-3 mt-1 border-t border-stone-200 px-1 pb-1 pt-2 text-xs leading-6 text-stone-600 dark:border-neutral-700 dark:text-neutral-300">
        {copy('portalGoogleNote', 'Google translates the four marked languages. English and Khmer are the official text.', 'Google បកប្រែភាសាទាំងបួនដែលមានសញ្ញា។ អត្ថបទផ្លូវការគឺភាសាអង់គ្លេស និងខ្មែរ។')}
      </p>
    </div>
  )
}

function MenuRow({ icon: Icon, label, value, onClick, popup }: { icon: IconComponent; label: string; value?: ReactNode; onClick: () => void; popup?: boolean }) {
  return (
    <button type="button" className={ROW} onClick={onClick} aria-haspopup={popup ? true : undefined}>
      <Icon aria-hidden="true" className={ROW_ICON} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value !== undefined && value !== '' ? <span className="max-w-[45%] shrink-0 truncate text-xs text-stone-600 dark:text-neutral-300">{value}</span> : null}
    </button>
  )
}

/** The phone menu: Contact, My List, Saved, Account, Language, Theme. Contact and Language swap the rows for their own list, with a Back row on top. */
export function DockMenuContent({ props, closeMenu }: { props: PortalDockProps; closeMenu: () => void }) {
  const { copy, darkMode, contactEntries, languageEnabled, languageOptions, activeLanguage, changePageLanguage, toggleTheme } = props
  const [view, setView] = useState<'rows' | 'contact' | 'language'>('rows')
  const labelId = useId()
  const run = (action?: () => void) => () => {
    closeMenu()
    action?.()
  }
  const count = (value: number | undefined) => (value && value > 0 ? <span translate="no" className="notranslate">{value}</span> : '')

  if (view !== 'rows') {
    return (
      <div data-portal-dock-menu-view={view}>
        <button type="button" className={ROW} onClick={() => setView('rows')}>
          {/* arrow-right turned round: arrow-left is pinned to the sign-in icon chunk, which the storefront must not load. */}
          <ArrowRight aria-hidden="true" className={`${ROW_ICON} rotate-180`} />
          <span>{copy('back', 'Go back', 'ត្រឡប់')}</span>
        </button>
        {view === 'contact'
          ? <PortalContactRows entries={contactEntries} copy={copy} onNavigate={closeMenu} className="w-72 max-w-[85vw] pb-1" />
          : <LanguageOptions copy={copy} options={languageOptions} active={activeLanguage} onPick={(value) => { changePageLanguage(value); closeMenu() }} />}
      </div>
    )
  }

  const activeOption = languageOptions.find((option) => option.value === activeLanguage)
  const themeWord = darkMode ? copy('themeDark', 'Dark', 'ងងឹត') : copy('themeLight', 'Light', 'ភ្លឺ')
  return (
    <div className="w-72 max-w-[85vw] py-1" role="group" aria-labelledby={labelId} data-portal-dock-menu="">
      <span id={labelId} className="sr-only">{copy('dockMenu', 'Menu', 'ម៉ឺនុយ')}</span>
      {contactEntries.length > 0 ? <MenuRow icon={MessageCircle} label={copy('contactButton', 'Contact', 'ទាក់ទង')} onClick={() => setView('contact')} popup /> : null}
      {props.onOpenList ? <MenuRow icon={ShoppingBag} label={copy('bucketTitle', 'My List')} value={count(props.listCount)} onClick={run(props.onOpenList)} /> : null}
      {props.onOpenWishlist ? <MenuRow icon={Heart} label={copy('saved', 'Saved')} value={count(props.wishlistCount)} onClick={run(props.onOpenWishlist)} /> : null}
      {props.onOpenAccount ? (
        <MenuRow
          icon={User}
          label={copy('account', 'Account')}
          value={props.accountSignedIn && props.accountName ? <span translate="no" className="notranslate">{props.accountName}</span> : ''}
          onClick={run(props.onOpenAccount)}
        />
      ) : null}
      {languageEnabled ? (
        <MenuRow
          icon={Globe}
          label={copy('dockLanguage', 'Language', 'ភាសា')}
          value={<span translate="no" className="notranslate">{activeOption?.label || ''}</span>}
          onClick={() => setView('language')}
          popup
        />
      ) : null}
      <MenuRow
        icon={darkMode ? Moon : Sun}
        label={copy('dockTheme', 'Theme', 'របៀប')}
        value={<span key={darkMode ? 'dark' : 'light'} translate="no" className="notranslate">{themeWord}</span>}
        onClick={run(toggleTheme)}
      />
    </div>
  )
}

export default function PortalDock(props: PortalDockProps) {
  const { copy, darkMode, hidden = false, contactEntries, onOpenAccount, accountSignedIn = false, onOpenList, listCount = 0, languageEnabled, languageOptions, activeLanguage, changePageLanguage, toggleTheme } = props
  const frame = props.placement === 'frame'
  if (hidden) return null

  const themeLabel = darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')

  const menuButton = (
    <div data-portal-dock-small="" className={`pointer-events-auto ${frame ? '' : 'min-[1888px]:hidden'}`}>
      <LazyPortalMenu
        align="right"
        trigger={(
          <button type="button" data-portal-dock-button="menu" className={ROUND_SMALL} aria-label={copy('dockMenu', 'Menu', 'ម៉ឺនុយ')}>
            <Menu aria-hidden="true" className="h-6 w-6" />
            {listCount > 0 ? <span translate="no" className={COUNT_BADGE}>{listCount}</span> : null}
          </button>
        )}
        content={({ closeMenu }) => <DockMenuContent props={props} closeMenu={closeMenu} />}
      />
    </div>
  )
  // The preview frame scrolls inside the admin shell, so there the dock is a zero-height sticky row at the end of the preview with the button
  // pinned to its bottom-right: it follows the frame's own scroll, never the admin window.
  if (frame) {
    return (
      <div data-portal-dock="frame" className="pointer-events-none sticky bottom-4 z-[55] h-0">
        <div className="absolute bottom-0 right-4">{menuButton}</div>
      </div>
    )
  }

  return (
    <div
      data-portal-dock=""
      className="pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-[55] max-[767px]:bottom-[max(calc(1rem+env(safe-area-inset-bottom)),calc(var(--install-band-clearance,0px)+0.5rem))]"
    >
      {/* From 1888 px: the stack, beside the content. The Contact button is the only filled one. */}
      <div data-portal-dock-wide="" className="pointer-events-auto hidden flex-col items-end gap-2 min-[1888px]:flex">
        {languageEnabled ? (
          <LazyPortalMenu
            align="right"
            trigger={(
              <button type="button" data-portal-dock-button="language" className={ROUND_WIDE} aria-label={copy('publicTranslation', 'Language tools')}>
                <Globe aria-hidden="true" className="h-5 w-5" />
              </button>
            )}
            content={({ closeMenu }) => (
              <LanguageOptions copy={copy} options={languageOptions} active={activeLanguage} onPick={(value) => { changePageLanguage(value); closeMenu() }} />
            )}
          />
        ) : null}
        <button key={darkMode ? 'to-light' : 'to-dark'} type="button" data-portal-dock-button="theme" className={ROUND_WIDE} onClick={toggleTheme} aria-label={themeLabel}>
          {darkMode ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
        </button>
        {onOpenAccount ? (
          <button type="button" data-portal-dock-button="account" className={`${ROUND_WIDE} ${accountSignedIn ? 'text-emerald-700 dark:text-emerald-300' : ''}`} onClick={onOpenAccount} aria-label={copy('account', 'Account')}>
            <User aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
        {onOpenList ? (
          <button type="button" data-portal-dock-button="shop" className={ROUND_WIDE} onClick={onOpenList} aria-label={copy('bucketTitle', 'My List')}>
            <ShoppingBag aria-hidden="true" className="h-5 w-5" />
            {listCount > 0 ? <span translate="no" className={COUNT_BADGE}>{listCount}</span> : null}
          </button>
        ) : null}
        {contactEntries.length > 0 ? (
          <PortalContactMenu
            entries={contactEntries}
            copy={copy}
            align="right"
            trigger={(
              <button type="button" data-portal-contact-trigger="" data-portal-dock-button="contact" className={CONTACT_BUTTON} aria-label={copy('contactUs', 'Contact us', 'ទាក់ទងយើង')}>
                <MessageCircle aria-hidden="true" className="h-5 w-5" />
                <span translate="no" className="notranslate">{copy('contactButton', 'Contact', 'ទាក់ទង')}</span>
              </button>
            )}
          />
        ) : null}
      </div>

      {/* Below 1888 px: one round button; the count of the list rides on it. */}
      {menuButton}
    </div>
  )
}
