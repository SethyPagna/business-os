import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { build } from 'esbuild'
import { waitForBrowser } from './browserProfileTeardown.ts'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
const useWebKit = process.env.BOS_LAZY_BROWSER === 'webkit'


const fixture = String.raw`
import React, { useState, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { lazyRetry } from "./src/utils/lazyImport.ts";
import { AppContext } from "./src/app/AppContextCore.tsx";
import en from "./src/lang/en.json";
import km from "./src/lang/km.json";
import { registerDirtyWork } from "./src/utils/dirtyWork.ts";
import { scheduleWorkDraftWrite } from "./src/utils/workDrafts.ts";
const params = new URL(location.href).searchParams;
const clean = params.has("clean"), late = params.has("late");
window.__dirty = !clean && !late;
if (late) window.fetch = () => new Promise((resolve) => {
  window.__resolveManifest = () => {
    window.__dirty = true;
    resolve(new Response(JSON.stringify({ hash: "next-build" }), { headers: { "content-type": "application/json" } }));
  };
});
const original = Storage.prototype.setItem;
if (!clean || params.has("denied")) Storage.prototype.setItem = function(k, v) {
  if (this === localStorage || params.has("denied")) throw new DOMException("quota", "QuotaExceededError");
  return original.call(this, k, v);
};
window.__ok = false;
window.__attempts = 0;
window.__mounted = 0;
const Child = lazyRetry(async () => {
  window.__attempts++;
  if (params.has("programming")) throw new Error("Invalid component module");
  if (!window.__ok) throw new TypeError("Failed to fetch dynamically imported module");
  return { default: ({ onClose }) => React.createElement("button", { id: "loaded", onClick: onClose }, "Loaded close") };
}, "dirty-fixture");
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? React.createElement("div", { id: "page-error" }, "Page failed") : this.props.children;
  }
}
function Parent() {
  const [value, setValue] = useState("unsaved draft"), [open, setOpen] = useState(false);
  useEffect(() => {
    window.__mounted++;
    return registerDirtyWork({ key: "fixture", pageId: "products", label: "draft", isDirty: () => window.__dirty });
  }, []);
  return React.createElement("div", null, React.createElement("input", { id: "draft", value, onChange: (e) => {
    setValue(e.target.value);
    scheduleWorkDraftWrite("fixture", e.target.value);
  } }), React.createElement("button", { id: "trigger", onClick: () => setOpen(true) }, "Open"), (open || params.has("always")) && React.createElement(Suspense, { fallback: React.createElement("div", { id: "pending" }, "Loading") }, React.createElement(Child, { open, ...params.has("nocallback") ? {} : params.has("cancel") ? { onClose: "invalid", onCancel: () => setOpen(false) } : { onClose: () => setOpen(false) } })));
}
createRoot(document.getElementById("root")).render(React.createElement(AppContext.Provider, { value: { language: params.has("km") ? "km" : "en", t: (key) => params.has("public") ? key : (params.has("km") ? km : en)[key] || key } }, React.createElement(Boundary, null, React.createElement(Parent))));

`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'dirty-nested-lazy-native-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
})
const bundle = built.outputFiles[0].text

const server = http.createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
})

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      const port = address.port
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

const appPort = await freePort()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(appPort, '127.0.0.1', () => resolve())
})

const browser = await (useWebKit ? webkit.launch({ headless: true }) : chromium.launch({ headless: true, executablePath: browserPath })).catch((error)=>{server.close();throw error})
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${appPort}/`)
function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  return waitForBrowser(read, 'browser state', timeoutMs)
}

async function evaluate<T>(expression: string): Promise<T> {
  return await page.evaluate(expression) as T
}
async function ready(): Promise<void> {
  await waitFor(async () => evaluate<boolean>('Boolean(document.querySelector("#trigger"))').then((ok) => ok ? true : null))
}

async function navigate(search = ''): Promise<void> {
  await page.goto(`http://127.0.0.1:${appPort}/${search}`)
  await ready()
}

let exitCode = 0
try {
  await ready()


  await page.locator('#draft').fill('kept typed draft');
  await page.locator('#trigger').click()
  await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))')?true:null);
  assert.equal(await evaluate<string>('document.querySelector("#draft").value'),'kept typed draft');
  assert.equal(await evaluate<number>('window.__mounted'),1);
  assert.equal(await evaluate<string|null>('localStorage.getItem("fixture")'),null,'the field survives without a persisted draft');
  assert.equal(await evaluate<boolean>('location.search.includes("__bos_reload")'),false);
  assert.equal(await evaluate<string|null>('sessionStorage.getItem("bos-nested-lazy-reload:dirty-fixture")'),null);
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector("#page-error"))'),false);
  for (const [selector, label] of [['[data-lazy-retry]', 'Retry'], ['[data-lazy-close]', 'Close']]) {
    assert.equal(await page.locator(selector).getAttribute('aria-label'), label)
    assert.equal(await page.locator(selector).getAttribute('title'), label)
    assert.equal(await page.locator(selector).locator('svg[aria-hidden="true"]').count(), 1)
  }

  for(const attempts of [6,9]){
    await page.locator('[data-lazy-retry]').click()
    await waitFor(async()=>await evaluate<boolean>('window.__attempts==='+attempts+'&&!document.querySelector("[data-lazy-retry]").disabled')?true:null);
    assert.equal(await evaluate<number>('document.querySelectorAll("[data-lazy-recovery]").length'),1);
    assert.equal(await evaluate<string>('document.querySelector("#draft").value'),'kept typed draft');
    assert.equal(await evaluate<number>('window.__mounted'),1);
  }
  await evaluate('window.__ok=true')
  await page.locator('[data-lazy-retry]').click()
  await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("#loaded"))')?true:null);
  assert.equal(await evaluate<number>('window.__mounted'),1);
  await page.locator('#loaded').click()
  assert.equal(await evaluate<string>('document.querySelector("#draft").value'),'kept typed draft');
  await evaluate('window.__ok=false')
  await page.locator('#trigger').click()
  await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("#loaded"))')?true:null);
  await page.locator('#loaded').click()
  await navigate();
  await page.locator('#trigger').click()
  await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-close]"))')?true:null);
  await page.locator('[data-lazy-close]').click()
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))'),false);
  assert.equal(await evaluate<number>('window.__mounted'),1);

  for(const mode of ['?denied=1','?clean=1&denied=1','?cancel=1','?nocallback=1','?km=1','?km=1&public=1','?late=1','?always=1']){
    await navigate(mode);
    await page.locator('#trigger').click()
    if(mode.includes('late')){await waitFor(async()=>await evaluate<boolean>('typeof window.__resolveManifest==="function"')?true:null);await evaluate('window.__resolveManifest()')}
    await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))')?true:null);
    assert.equal(await evaluate<number>('window.__mounted'),1);
    assert.equal(await evaluate<boolean>('location.search.includes("__bos_reload")'),false);
    assert.equal(await evaluate<string|null>('sessionStorage.getItem("bos-nested-lazy-reload:dirty-fixture")'),null);
    if(mode.includes('km')) {
      assert.equal(await page.locator('[data-lazy-close]').getAttribute('aria-label'), 'បិទ')
      assert.equal(await page.locator('[data-lazy-retry]').getAttribute('aria-label'), 'ព្យាយាមម្ដងទៀត')
    }
    await page.locator('[data-lazy-close]').click()
    assert.equal(await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))'),false);
    assert.equal(await evaluate<number>('window.__mounted'),1);
    if(mode.includes('always')){
      await page.locator('#trigger').click()
      await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))')?true:null);
      await page.locator('[data-lazy-close]').click()
      assert.equal(await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))'),false,'always-mounted closed modal stays closed and can reopen');
    }
  }
  await navigate('?clean=1');
  await page.locator('#trigger').click()
  await waitFor(async()=>await evaluate<boolean>('location.search.includes("__bos_reload")')?true:null);
  await ready();
  assert.ok(await evaluate<string|null>('sessionStorage.getItem("bos-nested-lazy-reload:dirty-fixture")'));

  await page.locator('#trigger').click()
  await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))')?true:null);
  assert.equal(await evaluate<number>('window.__mounted'),1,'clean marker prevents second navigation');
  await navigate('?programming=1');
  await page.locator('#trigger').click()
  await waitFor(async()=>await evaluate<boolean>('Boolean(document.querySelector("#page-error"))')?true:null);
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector("[data-lazy-recovery]"))'),false,'programming errors must reach the existing boundary');
  console.log(`PASS ${useWebKit ? 'WebKit' : 'Chromium'} mounted dirty nested lazy recovery, retry/close, and clean reload`);

} catch (error) {
  exitCode = 1
  console.error('FAIL dirty nested lazy native gestures')
  console.error(error)
}
await browser.close()
await new Promise<void>((resolve)=>server.close(()=>resolve()))
process.exitCode=exitCode
