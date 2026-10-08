import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { createServer, transformWithEsbuild } from 'vite';
import { chromium, webkit, expect, type Page } from '@playwright/test';
import { closeBrowserFixture } from './browserProfileTeardown.ts';
const artifactDirectory = process.env.MOBILE_INPUT_ARTIFACT_DIR;
if (artifactDirectory) mkdirSync(artifactDirectory, { recursive: true });
const root = path.resolve(import.meta.dirname, '..'), fixtureId = '\0mobile-input-fixture';
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import PortalMenu from '/src/components/shared/PortalMenu.tsx';
import AppSelect from '/src/components/shared/AppSelect.tsx';
import Modal from '/src/components/shared/Modal.tsx';
import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx';
import { useConfirmDialog } from '/src/components/shared/useConfirmDialog.tsx';
import en from '/src/lang/en.json';
import km from '/src/lang/km.json';
import '/src/styles/main.css';
const params = new URLSearchParams(location.search), pack = params.get('lang') === 'km' ? km : en;
const viewport = new EventTarget();
Object.assign(viewport, { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0 });
const listeners = { resize: new Set(), scroll: new Set() }, add = viewport.addEventListener.bind(viewport), remove = viewport.removeEventListener.bind(viewport);
viewport.addEventListener = (type, fn, ...rest) => { listeners[type]?.add(fn); add(type, fn, ...rest); };
viewport.removeEventListener = (type, fn, ...rest) => { listeners[type]?.delete(fn); remove(type, fn, ...rest); };
Object.defineProperty(window, 'visualViewport', { configurable: true, value: params.has('fallback') ? undefined : viewport });
window.fixtureViewport = (values, event = 'resize') => { Object.assign(viewport, values); viewport.dispatchEvent(new Event(event)); };
window.fixtureListeners = () => Object.fromEntries(Object.entries(listeners).map(([key, set]) => [key, set.size]));
window.detachedFocus = 0;
const originalFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (...args) { if (!this.isConnected)
    window.detachedFocus++; return originalFocus.apply(this, args); };
function Harness() {
    const { askToConfirm, confirmDialog } = useConfirmDialog(key => pack[key] || key);
    const [value, setValue] = useState('a'), [visible, setVisible] = useState(true);
    if (params.has('portal'))
        return <><style>{'[data-portal-menu-content].synthetic-authored-width { min-width:14rem; }'}</style><button id="outside" style={{ position: 'fixed', top: 8, left: 8 }}>Outside</button>
        <div style={{ position: 'absolute', top: 350, left: 24 }}><PortalMenu menuClassName={params.has('cap') ? 'min-w-[18rem] max-h-[min(28rem,calc(70*var(--app-vh)))]' : params.has('wide') ? 'synthetic-authored-width min-w-[14rem]' : ''} align={params.get('align') || 'auto'} trigger={<button id="portal-trigger">{pack.filters}</button>} content={<div style={{ width: 220, height: params.has('large') ? 900 : 160 }}><input id="search" aria-label={pack.search} placeholder={pack.search}/>
            <PortalMenu trigger={<button id="nested-trigger">Nested</button>} items={[{ label: 'Nested option', onClick: () => { } }]}/><button id="last" style={{ marginTop: params.has('large') ? 700 : 20 }}>Last action</button></div>}/></div>
        {params.has('nav') && <nav className="safe-area-inset-bottom" style={{ position: 'fixed', bottom: 0, width: '100%', height: 64 }}>Nav</nav>}</>;
    return <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t: key => pack[key] || key }}><Modal title={pack.branch} onClose={() => { }} unsavedChanges="read-only">
    <input id="before" aria-label="Before"/><div>{visible && <AppSelect id="select" ariaLabel={pack.branch} value={value} options={[{ value: 'a', label: pack.all_branches || 'Branch one' }, { value: 'disabled', label: 'Unavailable', disabled: true }, { value: 'b', label: pack.branch || 'Branch two' }]} onChange={v => { setValue(v); if (params.has('focus-other'))
            document.getElementById('after').focus(); if (params.has('confirm'))
            void askToConfirm({ title: 'Confirm selection', confirmLabel: 'Proceed', cancelLabel: 'Cancel' }); if (params.has('unmount'))
            flushSync(() => setVisible(false)); }}/>}<input id="after" aria-label="After"/><output id="value">{value}</output></div></Modal>{confirmDialog}</AppContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`;
const probe = net.createServer();
await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const address = probe.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const server = await createServer({ root, envFile: false, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: false }, plugins: [{
            name: 'mobile-input-fixture', resolveId(id) { if (id === 'virtual:mobile-input-fixture')
                return fixtureId; },
            async load(id) { if (id === fixtureId)
                return (await transformWithEsbuild(fixture, 'mobile-input-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code; },
            configureServer(vite) { vite.middlewares.use('/mobile-input-fixture', async (_req, res) => { res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml('/mobile-input-fixture', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:mobile-input-fixture"></script></body></html>')); }); },
        }] });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, failures = 0;
const check = async (name: string, run: () => Promise<void>) => { try {
    await run();
    console.log(`PASS ${name}`);
}
catch (error) {
    failures++;
    console.error(`FAIL ${name}`, error);
} };
const engines = process.env.MOBILE_INPUT_WEBKIT === '1' ? [chromium, webkit] : [chromium];
async function viewport(page: Page, values: Record<string, number>, event = 'resize') { await page.evaluate(({ values, event }) => (window as any).fixtureViewport(values, event), { values, event }); }
async function bounds(page: Page) { return page.locator('[data-portal-menu-content]').first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }); }
try {
    await server.listen();
    const origin = server.resolvedUrls!.local[0];
    assert.doesNotMatch(origin, /:5173\//);
    for (const engine of engines) {
        browser = await engine.launch({ headless: true });
        for (const mobile of engine === chromium ? [false, true] : [true])
            for (const lang of ['en', 'km']) {
                const context = await browser.newContext({ viewport: mobile ? (engine === chromium ? { width: 393, height: 851 } : { width: 375, height: 812 }) : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
                const page = await context.newPage(), errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
                const show = async (extra = '') => { await page.goto(`${origin}mobile-input-fixture?lang=${lang}${extra}`, { timeout: 180000 }); await expect(page.locator(extra.includes('portal') ? '#portal-trigger' : '#select')).toBeVisible(); };
                const label = `${engine.name()} ${mobile ? 'mobile' : 'desktop'} ${lang}`;
                await check(`${label} select keyboard/tap focus, disabled, outside, unmount`, async () => {
                    await show();
                    const trigger = page.locator('#select');
                    await trigger.focus();
                    await trigger.press('Enter');
                    for (let i = 0; i < 8 && !(await page.locator('[data-app-select-option="b"]').evaluate(el => el === document.activeElement)); i++)
                        await page.keyboard.press('Tab');
                    await expect(page.locator('[data-app-select-option="b"]')).toBeFocused();
                    await page.keyboard.press('Enter');
                    await expect(page.locator('#value')).toHaveText('b');
                    await expect(page.locator('[data-app-select-menu]')).toHaveCount(0);
                    await expect(trigger).toBeFocused();
                    assert.equal(await page.evaluate(() => scrollY), 0);
                    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, label.replaceAll(' ', '-') + '-select.png') });
                    await page.keyboard.press('Tab');
                    await expect(page.locator('#after')).toBeFocused();
                    await trigger.focus();
                    await trigger.press('Enter');
                    await trigger.press('ArrowUp');
                    await trigger.press('Enter');
                    await expect(trigger).toBeFocused();
                    await trigger.click();
                    await expect(page.locator('[data-app-select-option="disabled"]')).toBeDisabled();
                    await page.locator('[data-app-select-option="b"]')[mobile ? 'tap' : 'click']();
                    await expect(trigger).toBeFocused();
                    await trigger.press('Enter');
                    await page.locator('[data-app-select-option="b"]').focus();
                    await page.keyboard.press('Escape');
                    await expect(trigger).toBeFocused();
                    await trigger.click();
                    await page.locator('#after').click();
                    await expect(page.locator('[data-app-select-menu]')).toHaveCount(0);
                    await expect(page.locator('#after')).toBeFocused();
                    await show('&unmount');
                    await page.locator('#select').click();
                    await page.locator('[data-app-select-option="b"]').click();
                    await expect(page.locator('#select')).toHaveCount(0);
                    await page.waitForTimeout(40);
                    assert.equal(await page.evaluate(() => (window as any).detachedFocus), 0, 'synchronous unmount must not focus removed trigger');
                    assert.deepEqual(errors, []);
                });
                await check(`${label} caller-directed focus survives selection`, async () => {
                    for (const mode of ['focus-other', 'confirm']) {
                        await show('&' + mode);
                        await page.locator('#select').click();
                        await page.locator('[data-app-select-option="b"]').click();
                        await page.waitForTimeout(60);
                        await expect(mode === 'confirm' ? page.getByRole('button', { name: 'Proceed', exact: true }) : page.locator('#after')).toBeFocused();
                    }
                });
                await check(`${label} menu follows visible viewport events and tears down`, async () => {
                    await show('&portal');
                    await page.locator('#portal-trigger').click();
                    await expect.poll(async () => (await bounds(page)).top).toBeGreaterThan(300);
                    assert.deepEqual(await page.evaluate(() => (window as any).fixtureListeners()), { resize: 1, scroll: 1 });
                    await page.locator('#search').focus();
                    await viewport(page, { height: 400 });
                    await expect.poll(async () => (await bounds(page)).bottom, { message: 'resize while open must keep menu above keyboard' }).toBeLessThanOrEqual(392);
                    await viewport(page, { offsetTop: 250, offsetLeft: 16, width: 320 }, 'scroll');
                    await expect.poll(async () => (await bounds(page)).top).toBeGreaterThanOrEqual(258);
                    const r = await bounds(page);
                    assert.ok(r.bottom <= 642 && r.left >= 24 && r.right <= 328);
                    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, label.replaceAll(' ', '-') + '-viewport.png') });
                    await page.keyboard.press('Escape');
                    await expect(page.locator('[data-portal-menu-content]')).toHaveCount(0);
                    await expect(page.locator('#portal-trigger')).toBeFocused();
                    assert.deepEqual(await page.evaluate(() => (window as any).fixtureListeners()), { resize: 0, scroll: 0 });
                    await page.locator('#portal-trigger').click();
                    await page.locator('#outside').click();
                    await expect(page.locator('[data-portal-menu-content]')).toHaveCount(0);
                    assert.deepEqual(errors, []);
                });
                await check(`${label} oversized scrolling, bottom nav, alignment, nesting`, async () => {
                    for (const align of ['left', 'right', 'auto']) {
                        await show(`&portal&large&nav&align=${align}`);
                        await page.locator('#portal-trigger').click();
                        await expect.poll(async () => (await bounds(page)).bottom).toBeLessThanOrEqual(page.viewportSize()!.height - 72);
                        const menu = page.locator('[data-portal-menu-content]').first();
                        assert.ok(await menu.evaluate(el => el.scrollHeight > el.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)), 'oversized menu must scroll');
                        await viewport(page, { height: 220, offsetTop: 100 });
                        await expect.poll(async () => (await bounds(page)).bottom).toBeLessThanOrEqual(312);
                        assert.ok((await bounds(page)).top >= 108);
                        await page.locator('#last').scrollIntoViewIfNeeded();
                        await expect(page.locator('#last')).toBeVisible();
                        assert.ok(await menu.evaluate(el => el.scrollTop > 0), 'last action reachable');
                        const actionScroll = await menu.evaluate(el => el.scrollTop);
                        await viewport(page, { height: 220, offsetTop: 100 });
                        await expect.poll(async () => await menu.evaluate(el => el.scrollTop)).toBe(actionScroll);
                        await viewport(page, { height: page.viewportSize()!.height, offsetTop: 0 });
                        await expect.poll(async () => await menu.evaluate(el => el.clientHeight)).toBeGreaterThan(300);
                        await page.keyboard.press('Escape');
                    }
                    await show('&portal&fallback');
                    await page.locator('#portal-trigger').click();
                    await expect.poll(async () => (await bounds(page)).top).toBeGreaterThan(300);
                    assert.ok((await bounds(page)).bottom <= page.viewportSize()!.height - 8);
                    await page.keyboard.press('Escape');
                    await show('&portal');
                    await page.locator('#portal-trigger').click();
                    await page.locator('#nested-trigger').click();
                    await expect(page.locator('[data-portal-menu-content]')).toHaveCount(2);
                    await page.getByRole('button', { name: 'Nested option' }).focus();
                    await page.keyboard.press('Escape');
                    await expect(page.locator('[data-portal-menu-content]')).toHaveCount(1);
                    await expect(page.locator('#nested-trigger')).toBeFocused();
                    await page.locator('#search').fill('synthetic');
                    await expect(page.locator('[data-portal-menu-content]')).toHaveCount(1);
                    await page.keyboard.press('Escape');
                    await expect(page.locator('[data-portal-menu-content]')).toHaveCount(0);
                    assert.deepEqual(await page.evaluate(() => (window as any).fixtureListeners()), { resize: 0, scroll: 0 });
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                    assert.deepEqual(errors, []);
                });
                await check(`${label} caller height cap survives visible bounds, growth and reopen`, async () => {
                    await show('&portal&large&cap');
                    const trigger = page.locator('#portal-trigger'), menu = page.locator('[data-portal-menu-content]').first();
                    await trigger.click();
                    await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetHeight)).toBe(448);
                    assert.equal(await menu.evaluate((el: HTMLElement) => el.offsetWidth), 288);
                    await viewport(page, { height: 220, offsetTop: 100 });
                    await expect.poll(async () => (await bounds(page)).bottom).toBeLessThanOrEqual(313);
                    await page.locator('#last').scrollIntoViewIfNeeded();
                    assert.ok(await page.locator('#last').evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el; }), 'last action remains hit-testable');
                    await viewport(page, { height: page.viewportSize()!.height, offsetTop: 0 });
                    await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetHeight)).toBe(448);
                    await menu.locator(':scope > div').evaluate(el => { el.style.height = '80px'; el.querySelector('#last')?.remove(); });
                    await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetHeight)).toBeLessThan(160);
                    await menu.locator(':scope > div').evaluate(el => { el.style.height = '900px'; });
                    await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetHeight)).toBe(448);
                    await page.keyboard.press('Escape'); await trigger.click();
                    await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetHeight)).toBe(448);
                });
                await check(`${label} narrow viewport clamps authored minimum and restores caller widths`, async () => {
                    for (const variant of ['', '&cap', '&wide']) {
                        await show('&portal' + variant); const trigger = page.locator('#portal-trigger'), menu = page.locator('[data-portal-menu-content]').first();
                        await trigger.click();
                        const originalWidth = await menu.evaluate((el: HTMLElement) => el.offsetWidth);
                        assert.ok(originalWidth >= (variant === '&cap' ? 288 : variant === '&wide' ? 224 : 170), variant + ': authored width ' + originalWidth);
                        await viewport(page, { width: 125, offsetLeft: 16 }, 'scroll');
                        await expect.poll(async () => (await bounds(page)).right).toBeLessThanOrEqual(134);
                        assert.ok((await bounds(page)).left >= 24);
                        await viewport(page, { width: page.viewportSize()!.width, offsetLeft: 0 });
                        await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(originalWidth);
                        await viewport(page, { width: 125, offsetLeft: 16 });
                        await expect.poll(async () => (await bounds(page)).right).toBeLessThanOrEqual(134);
                        await viewport(page, { width: 125, offsetLeft: 16 }, 'scroll');
                        await expect.poll(async () => (await bounds(page)).right).toBeLessThanOrEqual(134);
                        await viewport(page, { width: page.viewportSize()!.width, offsetLeft: 0 });
                        await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(originalWidth);
                        await page.keyboard.press('Escape'); await trigger.click();
                        await expect.poll(async () => await menu.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(originalWidth);
                        await page.keyboard.press('Escape');
                    }
                });
                await context.close();
            }
        await browser.close();
        browser = undefined;
    }
}
catch (error) {
    failures++;
    console.error(error);
}
await closeBrowserFixture(failures ? 1 : 0, () => browser?.close(), () => server.close());
