/*
 * Listly's service worker — push notifications and nothing else.
 *
 * 🚨 THERE IS NO `fetch` HANDLER, AND THERE MUST NEVER BE ONE WITHOUT A PLAN.
 * A service worker that caches is how a PWA gets permanently stuck on an old
 * build: the cached index.html keeps loading the cached bundle, and no deploy
 * reaches the phone. With no fetch handler this worker never sees a request,
 * so every load goes to the network exactly as it did before it existed
 * (PROMPT-04 §2.2). Listly is offline-first through PowerSync's local
 * database, not through a cache — it has no need of one.
 *
 * `skipWaiting` + `clients.claim` so a changed sw.js takes over at once
 * rather than waiting for every Listly window to close, which on an installed
 * iPhone app can be days.
 *
 * Plain JS in public/ on purpose: it is served as-is at /listly/sw.js, with
 * scope /listly/, and never goes through the bundler.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// 🚨 iOS requires every push to show a notification. A push handled without
// one counts against the site, and repeated silent pushes get its permission
// revoked — so this always shows something, even for a payload it cannot read.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Listly'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : 'You have a job coming up.',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: 'icon-192.png',
      data: { url: typeof data.url === 'string' ? data.url : self.registration.scope },
    }),
  )
})

// Tapping the notification opens Listly on the right tab — and, for a job
// reminder, on the right JOB, which the page flashes (src/lib/openIntent.ts).
// An open Listly window is reused rather than a second one opened — a second
// window would fight the first for PowerSync's on-device database, which on
// iOS only one can hold.
//
// 🚨 THE DESTINATION IS ALSO WRITTEN DOWN (Adam, UAT 2026-09-25: taps landed
// on Shopping). On an iPhone, a cold start can open the app at start_url and
// drop `?tab=`, and a suspended page can miss the postMessage below. The page
// reads this note whenever it starts or comes to the front, and deletes it.
// Cache Storage used as a notepad — this worker still has NO fetch handler.
const OPEN_INTENT_CACHE = 'listly-open-intent'
const OPEN_INTENT_PATH = '__open-intent'

// A copy of jobIdFromTag() in src/lib/openIntent.ts (this file cannot import);
// scripts/verify-open-intent.ts proves the two agree. A job reminder's tag is
// its reminder_log key: '<house_jobs|my_jobs>:<job_id>:…'.
const JOB_TAG = /^(?:house_jobs|my_jobs):([^:]+):/

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || self.registration.scope, self.registration.scope)
  // Only ever somewhere inside Listly.
  const inside = target.href.startsWith(self.registration.scope) ? target : new URL(self.registration.scope)
  const job = JOB_TAG.exec(event.notification.tag || '')
  if (job && !inside.searchParams.has('job')) inside.searchParams.set('job', job[1])
  const url = inside.href

  const note = caches
    .open(OPEN_INTENT_CACHE)
    .then((c) =>
      c.put(
        new URL(OPEN_INTENT_PATH, self.registration.scope).href,
        new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }),
      ),
    )
    .catch(() => {})

  event.waitUntil(
    note
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((windows) => {
        for (const w of windows) {
          if (w.url.startsWith(self.registration.scope)) {
            w.postMessage({ type: 'listly:open', url })
            return w.focus()
          }
        }
        return self.clients.openWindow(url)
      }),
  )
})
