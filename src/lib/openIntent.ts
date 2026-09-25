import type { JobPage } from '../types'

/**
 * Where a tapped notification should land (Adam, UAT 2026-09-25: "when
 * tapping the reminder notifications, it opens the app to the Shopping page").
 *
 * The notification's URL has always said `?tab=house|mine|shopping`, and
 * public/sw.js has always passed it on. It still arrived on Shopping, because
 * on an iPhone the instruction can be lost two ways:
 *   - cold start: iOS may open the installed app at its start_url, not at
 *     the URL clients.openWindow() asked for, so `?tab=` never arrives;
 *   - warm start: the worker posts a message to a SUSPENDED page, which can
 *     miss it before iOS resumes it.
 *
 * 🚨 So the worker also WRITES the destination down, in Cache Storage under
 * one fixed key, and the app reads (and deletes) it whenever it starts or
 * comes back to the front. This is a note, not a page cache: there is still
 * no fetch handler, so nothing here can pin the app to an old build.
 *
 * `job=<id>` names the job whose reminder was tapped, so its row can flash.
 * The worker gets the id from the notification's tag, which for a job
 * reminder IS its reminder_log key — '<table>:<job_id>:…' (TECHNICAL.md §22).
 */

export const OPEN_INTENT_CACHE = 'listly-open-intent'
export const OPEN_INTENT_PATH = '__open-intent'
/** An intent older than this is not a tap the person is waiting on. */
export const OPEN_INTENT_MAX_AGE_MS = 5 * 60 * 1000

export type Tab = 'shopping' | JobPage

export interface OpenIntent {
  tab: Tab | null
  jobId: string | null
}

export function parseOpen(url: string, base = 'https://x/listly/'): OpenIntent {
  let params: URLSearchParams
  try {
    params = new URL(url, base).searchParams
  } catch {
    return { tab: null, jobId: null }
  }
  const t = params.get('tab')
  const tab = t === 'house' || t === 'mine' || t === 'shopping' ? t : null
  const job = params.get('job')
  // Only a job id on a jobs tab: a shopping notification opens Shopping, full stop.
  const jobId = job && /^[A-Za-z0-9_-]{1,64}$/.test(job) && (tab === 'house' || tab === 'mine') ? job : null
  return { tab, jobId }
}

/**
 * The job id inside a job reminder's tag ('house_jobs:<id>:…' or
 * 'my_jobs:<id>:…'), or null for anything else. public/sw.js carries a copy
 * of this one regex — plain JS, it cannot import — and
 * scripts/verify-open-intent.ts proves the two agree.
 */
export function jobIdFromTag(tag: string | null | undefined): string | null {
  const m = /^(?:house_jobs|my_jobs):([^:]+):/.exec(tag ?? '')
  return m ? m[1] : null
}

function intentKey(): string {
  return new URL(OPEN_INTENT_PATH, window.location.origin + import.meta.env.BASE_URL).href
}

/**
 * Read and DELETE the destination the worker wrote, if it is fresh. Never
 * throws: no Cache Storage, a private window, or nothing written all mean
 * "no intent", and the app simply opens where it would have.
 */
export async function takePendingOpen(now = Date.now()): Promise<string | null> {
  try {
    if (!('caches' in window)) return null
    const cache = await caches.open(OPEN_INTENT_CACHE)
    const key = intentKey()
    const hit = await cache.match(key)
    if (!hit) return null
    await cache.delete(key)
    const body = (await hit.json()) as { url?: unknown; at?: unknown }
    if (typeof body.url !== 'string' || typeof body.at !== 'number') return null
    return now - body.at <= OPEN_INTENT_MAX_AGE_MS ? body.url : null
  } catch {
    return null
  }
}
