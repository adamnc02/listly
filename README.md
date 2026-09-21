# Listly

A phone-first PWA for shopping lists and jobs, shared between two phones. Three tabs — **Shopping**,
**House jobs**, **My jobs** — and one thing that is not obvious from those: finishing a shop can post
the spend into [`shared-finance-ledger`](https://github.com/adamnc02/shared-finance-ledger) as a real
transaction.

Live at **https://adamnc02.github.io/listly/**, served from the `gh-pages` branch and installed on
an iPhone Home Screen. **Listly targets iOS**; Android is out of scope.

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

### The ledger bridge writes ONE row, and only ever forwards.

Finishing a priced shop writes a `listly.shop_completions` row; a trigger **inside the database**
turns it into a `shared_finance_ledger.transactions` row. That is the whole of Listly's write path
into another app's schema. Three rules hold it together:

- **The trigger must never `raise`.** A raising trigger blocks that device's *entire* PowerSync
  upload queue, so a stale category id would stop the shopping list syncing. It records
  `ledger_error` and returns, and the app surfaces that with a Retry.
- **A transaction deleted in the ledger stays deleted.** Deleting it there is a decision; Listly does
  not quietly undo it. The trigger refuses to re-book a completion that already carries a
  `transaction_id`.
- **What was bought never crosses.** Only the amount, date, category, account and the list's *name*
  reach the ledger. The ticked items are kept in `shop_completions.items_snapshot`, which the trigger
  never reads.

After Save, a short confirmation plays — £ notes flying from a wallet to a shop — and ends on a
tick **only once the ledger has confirmed the transaction**. Offline it ends on "Saved — it'll reach
the ledger when you're back online" instead, and on a refusal a red cross. A tick on a timer would be
a lie whenever there is no signal (`TECHNICAL.md` §9).

`docs/LEDGER-INTEGRATION.md` is the full picture, and the page a *ledger* developer should read.

### A Current Account shop rounds up, and Listly decides it — not the database.

A £7.50 Current Account shop is booked as **£8.00**, remembering the real price, and the 50p funds
that person's Coin Jar in the ledger — the same thing the ledger's own entry does. Three rules:

- **The person sees it before the shop is booked.** A round-up step appears in Finish shop, showing
  the real price, the rounded figure and where the difference goes. The trigger **carries** those
  values and computes nothing, so the booked row cannot contradict the screen that was tapped.
- **It appears only when it really applies** — a Current Account shop, dated today, not already a
  whole pound, for a person whose round-ups are on and who has a Coin Jar. Otherwise it shows
  nothing at all. 🚨 It is the **owner of the picked account's** switch and jar, never the
  signed-in user's.
- 🚨 **A backdated shop does not round, deliberately.** Answering "was rounding on *then*" would
  mean a second copy of the ledger's dated on/off walk living in SQL, free to drift. Change the date
  away from today and the step disappears — visibly. A backdated expense entered *in the ledger app*
  still rounds on its own date.

The switch itself is not synced to Listly; one read-only RPC answers it, and the answer is
remembered per person so Finish shop still works with no signal. Anything unknown reads as "off".
`TECHNICAL.md` §9a.

### Cancelling Finish shop changes nothing, and that is load-bearing.

Nothing is deleted until the outcome is known — Save and "Don't price it" clear the ticked items,
cancel does not. It is deliberately **not** implemented as delete-then-restore: re-inserting items
would mint new ids, and an item's identity has to stay stable or two devices never converge on it.
`snapshotShop()` is read-only; `finishShop()` is the destructive half. Keep them apart.

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

Any new overlay must also respect the stacking contract, because the bottom nav now floats:

| Layer | z-index |
|---|---|
| scrolling content | 0–2 |
| edge fades | 50 |
| floating nav | **100** |
| the sync-error banner | 400 |
| modal overlays (`.sheet-root`) | **500** |

### The nav is `position: absolute`, not `fixed`.

`fixed` on iOS standalone relies on WebKit's own internal sense of the viewport, which is stale on
first paint until a real scroll forces a recompute — and Listly locks page scrolling, so that scroll
never comes. `html`, `body`, `.app` and the nav are all sized from one JS-measured `--app-height`.
It is also a pill inset 12px each side, because a full-bleed bar's corners collide with the phone's
own rounded screen corners.

### A control with nothing to do says so BEFORE it is tapped.

Every "add"-style control, and Finish shop, renders at `.waiting` opacity while there is nothing to
do, explains itself if tapped anyway, and names a failed write rather than swallowing it. A control
that silently ignores a tap is indistinguishable from a broken one — that cost three rounds of
debugging on "Add list did nothing".

🚩 The rule is `.waiting`, **unscoped**. It used to be `.btn.waiting`, which silently excluded the
round `+` add-item button (an `.icon-btn`), so that button carried the class and got no styling at
all for a week.

### A different account signing in clears the device first.

PowerSync keeps its on-device database across a sign-out. Before 2026-09-21 nothing cleared it, so
the next account on a phone was shown the previous one's lists **and private My jobs** until enough
relaunches let its own sync replace them (Adam: "the old list remains, it takes several force
closes"). `SyncRoot` now remembers the last account on the device and, when a **different** one
signs in, calls `disconnectAndClear()` before anything reads the database — the rule
`shared-finance-ledger` has always had (`lib/accountSwitch.ts`, `scripts/verify-account-switch.ts`).
The same account signing back in keeps its data, unsent changes included; the Account sheet warns
before a sign-out would leave changes unsent. **Don't remove it, and don't make sign-out clear the
device either** — that would lose unsent changes for the common case of signing straight back in.

### The service worker has no `fetch` handler.

`public/sw.js` exists for push notifications only. A service worker that caches is how a PWA gets
stuck on an old build permanently — every deploy silently fails to reach the phone. Listly is
offline-first through PowerSync's local database, not through a cache, so it needs none. **Adding
a `fetch` handler needs a versioning and update plan first**, tested against upgrading from the
deployed build.

### Reminders are push only, so Settings must tell the truth per device.

There is no email fallback (Adam, 2026-09-21). A phone that is not on the Home Screen with
permission granted is simply not reminded, and the Reminders section says so rather than showing a
button. A device reads "gets reminders" only when the **server** has its registration, never from
the browser's own subscription alone (`TECHNICAL.md` §22).

## Running it

```bash
npm install
npm run dev        # localhost:5173
npm run build      # tsc -b && vite build
npm run preview    # serve the built app at /listly/
npm run lint
npm run deploy     # builds, then publishes dist/ to the gh-pages branch

# The verify scripts (plain tsx, ✓/✗). Run them all, strictly:
for f in scripts/verify-*.ts; do TZ=Europe/London npx tsx "$f" || echo "FAIL: $f"; done
```

> `npm run deploy` publishes the live site. Per this project's working rules it is **never** run
> without Adam asking for it in so many words.
>
> There is no CI: the `gh-pages` branch is whatever the last `npm run deploy` pushed, built from
> whatever was in the working tree at the time. Deploy from `main`, after merging.

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
VAPID **private** key is a Supabase secret, set in the dashboard, and must never
reach this repo.

`VITE_POWERSYNC_DB_FILENAME` has **no default on purpose**. Four apps share the origin
`adamnc02.github.io`, so they share browser storage; Listly's local database must be `listly.db` and
nothing else. A build that forgets it should fail loudly rather than quietly collide with another
app's data.

## Where everything else is written down

| Document | Holds |
|---|---|
| `TECHNICAL.md` | The module-by-module reference: the shell, the data layer, every screen and sheet, and the rules each one encodes. |
| `docs/ARCHITECTURE.md` | The sync layer: the two Sync Streams, the `lst_`/`lst_ref_` prefixes and why, upload ordering, the mapping boundary. |
| `docs/LEDGER-INTEGRATION.md` | **The page a ledger developer should read.** The gate, the trigger, the field mapping, and the blast-radius table. |
| `silver-octo-invention/docs/listly-SUPABASE.md` | The schema, RLS and functions, plus a generated ERD. |
| `Downloads/App Development & Bug Tracking/listly/` | The build plan, prompts, Adam's dashboard tasks, app knowledge and the UAT scripts. |

The planning documents (`LISTLY-DESIGN.md`, `listly-prototype.html`) deliberately do **not** live in
this repo — they are design inputs, and their home is that Downloads folder.
