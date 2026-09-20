# Listly

A phone-first PWA for shopping lists and jobs, shared between two phones. Three tabs — **Shopping**,
**House jobs**, **My jobs** — and one thing that is not obvious from those: finishing a shop can post
the spend into [`shared-finance-ledger`](https://github.com/adamnc02/shared-finance-ledger) as a real
transaction.

Live at **https://adamnc02.github.io/listly/** (after the first deploy).

## Stack

Vite · React 19 · TypeScript · Supabase (auth + Postgres) · PowerSync (offline-first sync).

Listly is the **fourth app** on one Supabase project, in its own `listly` schema, and the first one
that depends on another app's functions. It shares the project with `personal_finance` (personal-f),
`my_dream_clean` and `shared_finance_ledger`, and shares **one** `powersync_role`, **one** `powersync`
publication and **one** PowerSync instance with them. Everything Listly adds is additive.

## Rules that must not be quietly undone

These are here because each one is cheap to break by accident and expensive to discover.

### Sign-in is required from the first screen. There is no guest mode.

Not a product preference — a deliberate defence. In this stack, signing in for the first time makes
all pre-existing local data **silently invisible**: the app stops reading `localStorage` and starts
reading PowerSync's local database, and nothing warns you. That is
[`MIGRATION-LESSONS.md` §24](../Supabase%20Migration/MIGRATION-LESSONS.md), it cost a family member's
data on another app in this project, and the fix there was a whole migration component.

Listly sidesteps it entirely by never having pre-auth data to lose. **Adding a local-only or guest
mode would reintroduce the single worst trap in this stack**, so don't — and if it ever seems
necessary, build the `LegacyDataMigration` equivalent first, in the same change.

### `listly-apple-touch-icon.jpg` at the repo root is the icon master. Never overwrite it.

`public/apple-touch-icon.png`, `public/icon-192.png` and `public/icon-512.png` are all generated from
it, the same way `shared-finance-ledger` keeps `shared-ledger-apple-touch-icon.png` at its root. To
regenerate them, re-measure the tile's bounding box first (the source has a white margin around a
rounded cream tile) and crop just inside it — JPEG compression leaves a soft halo at the edge. The
corners outside the tile's radius are then filled with the tile's own cream `#F5EFE6`, so no white
shows on Android or in a browser tab, where icons are not masked to a rounded square.

### There is no `DIVERGENCE.md` here, and there should not be one.

`shared-finance-ledger` has one because it is a copy of `personal-ledger` and has to stay in step with
it. **Listly is not a copy of anything**, so there is nothing to keep in step and nothing to enforce.
Adding one out of habit would create a rule with no meaning that someone would then feel obliged to
follow.

### Dates go through `src/lib/date.ts`, always.

It is a **byte-identical** copy of the ledger's, left unannotated on purpose so a `diff` proves it has
not drifted. Never `new Date().toISOString().slice(0, 10)` (rolls the date back a full day during
BST) and never `new Date('2026-09-20')` on a bare date string (parses as UTC midnight and compares as
*later* than a local-midnight date for the same day). Both are real, live bugs the ledger already paid
for; the second was Adam-reported on 2026-09-16.

### Overlays use `createPortal(..., document.body)` from the start.

Page components render inside `<main>`, which is `overflow-y: auto`. A bare `fixed` or `absolute`
overlay inside one gets clipped, and neither a z-index bump nor switching to `absolute` fixes it — the
second makes it worse. `MIGRATION-LESSONS.md` §15 took three attempts to reach that conclusion.
`src/components/Sheet.tsx` is the one place this is implemented; use it.

## Running it

```bash
npm install
npm run dev        # localhost:5173
npm run build      # tsc -b && vite build
npm run preview    # serve the built app at /listly/
npm run lint
npm run deploy     # builds, then publishes dist/ to the gh-pages branch
```

> `npm run deploy` publishes the live site. Per this project's working rules it is **never** run
> without Adam asking for it in so many words.

### `.env.local`

Create it **from the terminal, never from Finder** — macOS can silently drop the leading dot when
renaming, and Vite then ignores the file with no error at all
([`MIGRATION-LESSONS.md` §9](../Supabase%20Migration/MIGRATION-LESSONS.md)).

```bash
VITE_SUPABASE_URL=https://nxekrfdagkdwhjuunsrl.supabase.co
VITE_SUPABASE_ANON_KEY=<the project's publishable key>
VITE_POWERSYNC_URL=https://6a97292902481fb31b92f94b.powersync.journeyapps.com
VITE_POWERSYNC_DB_FILENAME=listly.db
VITE_VAPID_PUBLIC_KEY=<public half of the VAPID pair>
```

**Nothing in `.env.local` should ever be a value that matters if seen.** The anon key is public by
design — RLS protects the data, not the key — and the VAPID *public* key is public by definition. The
VAPID **private** key and any email API key are Supabase secrets, set in the dashboard, and must never
reach this repo.

`VITE_POWERSYNC_DB_FILENAME` has **no default on purpose**. Four apps share the origin
`adamnc02.github.io`, so they share browser storage; Listly's local database must be `listly.db` and
nothing else. A build that forgets it should fail loudly rather than quietly collide with another
app's data.

## Where everything else is written down

| Document | Holds |
|---|---|
| `docs/ARCHITECTURE.md` | The sync layer: the two Sync Streams, the `lst_`/`lst_ref_` prefixes and why, upload ordering, the mapping boundary. |
| `docs/LEDGER-INTEGRATION.md` | **The page a ledger developer should read.** The gate, the trigger, the field mapping, and the blast-radius table. |
| `silver-octo-invention/docs/listly-SUPABASE.md` | The schema, RLS and functions, plus a generated ERD. |
| `Downloads/App Development & Bug Tracking/listly/` | The build plan, prompts, Adam's dashboard tasks and app knowledge. |

The planning documents (`LISTLY-DESIGN.md`, `listly-prototype.html`) deliberately do **not** live in
this repo — they are design inputs, and their home is that Downloads folder.
