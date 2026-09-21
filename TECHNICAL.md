# Listly — Technical Documentation

The module-by-module reference: the app shell, the data layer, every screen and sheet, and the
rules each one encodes.

**This document does not repeat the sync layer.** `docs/ARCHITECTURE.md` owns that — the two Sync
Streams, the `lst_`/`lst_ref_` prefixes, subscribe-before-connect, the household guard, upload
ordering and the mapping boundary. `docs/LEDGER-INTEGRATION.md` owns the bridge into
`shared_finance_ledger` and is the page a *ledger* developer should read. README.md owns the rules
that must not be quietly undone. Start there; this is the map of everything else.

---

## Table of contents

1. [Stack and shape](#1-stack-and-shape)
2. [The app shell](#2-the-app-shell)
3. [Design tokens and the stacking contract](#3-design-tokens-and-the-stacking-contract)
4. [Domain types](#4-domain-types)
5. [`ListlyContext` — the data layer](#5-listlycontext--the-data-layer)
6. [Per-device state](#6-per-device-state)
7. [Dates](#7-dates)
8. [Module: Shopping](#8-module-shopping)
9. [Module: Finish shop](#9-module-finish-shop)
10. [Module: Manage lists](#10-module-manage-lists)
11. [Module: Item edit](#11-module-item-edit)
12. [Module: House jobs and My jobs](#12-module-house-jobs-and-my-jobs)
13. [Module: Due-soon banners](#13-module-due-soon-banners)
14. [Module: Ledger errors](#14-module-ledger-errors)
15. [Module: Account and household](#15-module-account-and-household)
16. [Sheets and overlays](#16-sheets-and-overlays)
17. [Drag reordering](#17-drag-reordering)
18. [Sync visibility: the dot and the diagnostics](#18-sync-visibility-the-dot-and-the-diagnostics)
19. [The inert-control rule](#19-the-inert-control-rule)
20. [Icons and the icon master](#20-icons-and-the-icon-master)
21. [Build, deploy and environment](#21-build-deploy-and-environment)
22. [What is not built yet](#22-what-is-not-built-yet)

---

## 1. Stack and shape

Vite · React 19 · TypeScript · Supabase (Auth + Postgres) · PowerSync (offline-first sync) ·
`nanoid`. No CSS framework: one hand-written stylesheet, `src/index.css`. No router: three tabs
held in one `useState`. **iOS is the target; Android is out of scope.**

```
main.tsx
└── App.tsx
    └── AuthProvider                  Supabase session
        └── Gate                      session undefined → nothing; null → AuthGate
            └── SyncRoot              ensure_household → connect → subscribe → the §38 guard
                └── ListlyProvider    watched queries + narrow SQL writes
                    └── Shell         header · banners · <main> · nav · account sheet
```

```
src/
  App.tsx                 The shell and the gate
  types.ts                The domain types
  index.css               The whole design system
  context/
    AuthContext.tsx       Supabase session state
    ListlyContext.tsx     The data layer — the one boundary the UI talks to
  pages/
    Shopping.tsx          Tab 1
    JobsPage.tsx          Tabs 2 and 3, one component
  components/
    Sheet.tsx             The portal bottom sheet — every overlay uses it
    ShoppingList.tsx      One list card
    FinishShopSheet.tsx   "Price this shop"
    ManageListsSheet.tsx  Every list, hidden ones included
    ItemEditSheet.tsx     Rename / delete / move an item
    JobEditSheet.tsx      Edit a job
    DueSoonBanners.tsx    The red banners, on every tab
    LedgerErrors.tsx      "Couldn't add to the ledger — tap to retry"
    AccountModal.tsx      Identity, link code, delete my app data
    AuthGate.tsx          Sign-in
    SyncRoot.tsx          Boot and the household guard
    SyncStatusDot.tsx     Is this actually syncing?
    SyncDiagnostics.tsx   Why not?
    BottomNav.tsx  Icons.tsx
  lib/
    date.ts               A byte-identical copy of the ledger's
    ids.ts  jobs.ts  deviceState.ts  useDragReorder.ts
    supabaseClient.ts
    powersync/            tables · schema · mapping · writes · connector · database
                          household · linking · ledger · useWatchedQuery
                          describeSyncError · bootLog
docs/
  ARCHITECTURE.md         The sync layer
  LEDGER-INTEGRATION.md   The bridge
scripts/print-sync-streams.ts
```

---

## 2. The app shell

`App.tsx`'s `Shell` is: a header (logo, wordmark, sync dot, account button), the due-soon banners,
a `.main-wrap` holding `<main>` plus its two edge fades, the bottom nav, and the account sheet.

**The banners sit in the shell, not on the jobs pages,** because they show on **every** tab — a job
due tomorrow needs to reach you while you are looking at the shopping list.

**The fades are siblings of `<main>` inside their own wrapper, not children of `.app`.** Anchored
to `.app`, a top fade would sit over the header — which does not scroll — and fade the wrong thing.

**The logo is referenced from `public/apple-touch-icon.png`**, not embedded as base64. The
prototype's data URI is 27KB of its bulk and would be carried into every build for no reason.

**The header carries no date.** Every screen already says what it is, and the due chips carry the
only dates that matter.

### The gate

```tsx
if (session === undefined) return null   // still checking — never flash the sign-in screen
if (session === null) return <AuthGate />
return <SyncRoot><ListlyProvider><Shell /></ListlyProvider></SyncRoot>
```

> 🚨 **Sign-in is required from the first screen and there is no guest mode.** In this stack,
> signing in for the first time makes all pre-existing local data **silently invisible**: the app
> stops reading `localStorage` and starts reading PowerSync's local database, with no warning.
> Listly sidesteps it entirely by never having pre-auth data to lose. **Adding a local-only or
> guest mode would reintroduce the worst trap in this stack** — and if it ever seems necessary,
> build the ledger's `LegacyDataMigration` equivalent first, in the same change.

### The nav is `position: absolute`, not `fixed`

`fixed` on iOS standalone relies on WebKit's own sense of the viewport, which is stale on first
paint until a real scroll forces a recompute — and Listly locks page scrolling, so that scroll
never comes. `html`, `body`, `.app` and the nav are all sized from one JS-measured `--app-height`,
set in `index.html`. The nav is a pill inset 12px each side, because a full-bleed bar's corners
collide with the phone's own rounded screen corners; `--nav-h` lets `<main>` reserve room for it
once it leaves the flow.

---

## 3. Design tokens and the stacking contract

`src/index.css` is the design system, and its values are `LISTLY-DESIGN.md` §5 — the prototype's
inline stylesheet restructured for the real build. **Listly has no dark mode**: the palette comes
from the logo and the app is one cream surface by design, so there is no second theme to define.

Cream ground `#F5EFE6`, paper `#FFFCF7`, ink `#3B2F26`, a brown accent `#8A5E34`, a sage accent
`#6F8C5E`, and one red `#B3362C` for overdue and error states, plus chip, done and grip tints.

> 🚨 **`--ground-rgb` is an RGB triplet on purpose.** The edge fades must write their transparent
> end as `rgba(<bg>, 0)` and **never** the `transparent` keyword: some browsers interpolate
> `transparent` through transparent **black**, and the gradient visibly darkens in the middle. Keep
> it in step with `--ground`.

`--app-height`, `--safe-top` and `--safe-bottom` have CSS fallbacks that `index.html` **overwrites
with measured pixels** on first paint; the CSS values cannot be trusted on iOS standalone.

### The stacking contract

Any new overlay must respect it, because the nav floats:

| Layer | z-index |
|---|---|
| scrolling content | 0–2 |
| edge fades | 50 |
| floating nav | **100** |
| the sync-error banner | 400 |
| modal overlays (`.sheet-root`) | **500** |

---

## 4. Domain types

`src/types.ts` holds the app's shapes, not the database's — deliberately close to the design doc's
data model so the prototype's behaviour reproduces exactly, and close to the schema so the mapping
layer is a rename rather than a redesign.

| Type | Notes |
|---|---|
| `IsoDate` | `'YYYY-MM-DD'`. `''` means "no due date", matching the `'' ↔ NULL` rule the sync layer applies |
| `Item` | `id`, `text`, `done` |
| `List` | plus `isDefault`, `createdAt`, `neverHadItems`, `categoryId` |
| `Job` | `page` (`'house' \| 'mine'`), `text`, `due`, `remind`, `done` |
| `DeviceState` | `openLists`, `dismissedBanners`, `doneOpen` — never synced (§6) |
| `LedgerCategory` | Read through the `lst_ref_categories` mirror. Listly reads these and writes them never |
| `LocationOption` | One entry in the Finish-shop location picker |
| `ShopCompletionDraft` | What Finish shop collects before writing a completion row |

Two details that are easy to get wrong:

- 🚨 **`List.neverHadItems` is not derivable from `created_at`.** The rule is "a list you have just
  created stays visible while empty, until it has held items and been emptied". `created_at` can
  express "made recently"; it cannot express "has never had an item". It is its own column.
- 🚨 **`List.categoryId` and `LedgerCategory.id` carry an `@<household_id>` suffix verbatim.**
  Never stripped, never added to. It is the ledger's own mechanism for keeping 35 fixed built-in
  category ids unique per household.

`Job.remind` is never true while `due` is `''`. That is enforced three times over — in the edit
sheet's UI, on every write in the context, and by a CHECK constraint in the database — because a
reminder fires three days before a due date and without one there is nothing for it to fire
against.

---

## 5. `ListlyContext` — the data layer

> 🚨 **The interface has not changed since Phase 1, when the data was in memory.** That was the
> point of putting the boundary here: every page, sheet and component was written against this
> shape, and **none of them needed touching when the backend arrived.** `useState` became watched
> queries; the mutators became narrow SQL. Keep it that way — a component that reaches past this
> into PowerSync is a component that cannot be re-backed.

The value, by area:

- **Lists and items** — `lists`, `visibleLists`, `addList`, `deleteList`, `toggleDefault`,
  `setListOpen`, `addItem`, `toggleItem`, `saveItem`, `deleteItem`, `reorderItems`.
- **Finishing a shop** — `snapshotShop`, `finishShop` (§9).
- **The ledger bridge** — `ledgerGateOpen`, `categories`, `locationOptions`, `setListCategory`,
  `saveShopCompletion`, `failedCompletions`, `retryLedger`.
- **Jobs** — `jobsFor`, `addJob`, `toggleJob`, `toggleRemind`, `saveJob`, `deleteJob`,
  `setDoneOpen`.
- **Device** — `device`, `dismissBanner`.

Reads are `useWatchedQuery` over the local PowerSync database, so every one of them re-evaluates on
each sync delivery. Writes are fire-and-forget through a `run()` helper that **logs a failure and
never silently swallows it**; the mutators that a control waits on (`addList`, `addItem`, `addJob`,
`saveShopCompletion`) return Promises so the caller can name the failure on screen (§19).

### The D4 gate

```
ledgerGateOpen === the household has at least one `people` row
```

Everything ledger-shaped is behind it: the price step, and the category chip in Manage lists. With
no ledger, **none of it renders** — not greyed out, not empty. Nothing on screen should mention a
ledger that does not exist.

> 🚨 **It is not a category count.** `ensure_household()` seeds 35 categories into every household,
> so a count is never zero and would open the flow on day one for someone with no ledger.

Every ledger read goes through a `lst_ref_` **local mirror**, never the network: the gate and the
location picker have to work standing in a shop with no signal, and Finish shop must not add a
request. **Listly never writes any of those tables** — the connector refuses to upload them, and
the only write Listly makes into that schema is the single transactions row, which happens inside
the database via a trigger.

---

## 6. Per-device state

`src/lib/deviceState.ts`. Which lists are expanded, which banners are dismissed, which Done
sections are open: **`localStorage`, never a column.**

Syncing them would mean one partner collapsing the Tesco list collapses it on the other's phone
mid-shop. So `is_open` never becomes a column in `listly.shopping_lists`, and this file is where
that decision lives. The context keeps it in a separate `device` slice so it stays obvious it is
not household data.

**A banner dismissal stores the date it happened rather than `true`**, so a dismissal made
yesterday is simply not a dismissal today — with no clean-up job needed. "Or the job is edited" is
handled at the point of the edit, by `clearDismissal`.

Everything here is wrapped in `try/catch` and falls back to defaults. A private window, cleared
site data, or a browser refusing storage must leave the app fully working: losing which lists were
expanded is not a failure worth an error.

---

## 7. Dates

`src/lib/date.ts` is a **byte-identical copy of the ledger's**, left unannotated on purpose so a
`diff` proves it has not drifted. Every date in the app goes through it.

> 🚨 Two live bugs the ledger has already paid for:
> - `new Date().toISOString().slice(0, 10)` rolls the calendar date **back a full day** during BST,
>   so a job due today reads as due yesterday;
> - `new Date('2026-09-20')` on a bare date string parses as **UTC** midnight and compares as
>   *later* than a locally built Date for the same day.
>
> Build and parse only through `todayIso()` and `parseLocalDate()`.

`<input type="date">` speaks `'YYYY-MM-DD'`, which is exactly `IsoDate`, so the form fields need no
conversion at all.

`src/lib/jobs.ts` holds the derived date logic: `daysUntil` (negative is overdue), `isDueSoon`
(within 3 days or overdue — the rule for both the red chip and the banner), `dueLabel` (the chip's
exact wording: *Overdue by N days* / *Overdue since yesterday* / *Due today* / *Due tomorrow* /
*Due in N days · Tue 23 Sep* / *Due Tue 23 Sep*), and `sortOpenJobs` (dated first, soonest first;
undated after them). `sortOpenJobs` sorts **a copy** — sorting in place would mutate context state.

---

## 8. Module: Shopping

`pages/Shopping.tsx` + `components/ShoppingList.tsx`.

The page is: a heading with a **Manage lists** button, the ledger-error banner (§14), every
*visible* list, and a dashed "new list" box at the bottom. **That box makes a non-default list** —
default ones are made in Manage lists.

`ShoppingList` is one card: a tappable header (chevron, name, a star if it is a default, and a
count pill reading `empty` / `N to get` / `all got`), the items, an add field, and **Finish shop**.

**The hint line above Finish shop says what will happen, in the prototype's exact words:**

| State | Hint |
|---|---|
| Nothing ticked | "Tick what you bought, then finish the shop." |
| Some ticked | "N unticked will stay for next time." |
| All ticked, default list | "Everything's ticked — list will be emptied (it's a default, so it stays)." |
| All ticked, ordinary list | "Everything's ticked — list will be emptied and hidden." |

The count pill, that hint and the empty note **are the design, not placeholder copy.**

**Visibility.** A list hides itself when empty — unless it is a default, or it has never held an
item (§4). Manage lists is where a hidden list is found again.

Items reorder by long-press drag (§17). Tapping an item's text opens the item sheet (§11); tapping
its box ticks it.

---

## 9. Module: Finish shop

`components/FinishShopSheet.tsx`. Three steps — **amount**, **date**, **location** — then Save. A
list with no category gets a fourth step at the **front**, once ever, and the answer is saved back
onto the list, so the normal case stays three.

> 🚨 **Most of a transaction is not a decision anyone wants to make at the till.** `type` is always
> expense, `direction` always out, `payment_method` always card, `note` is the list name verbatim,
> and `owner_id`/`pot_id` come from the location picked. **None of those has UI, deliberately** —
> which is also why there is no separate "who is this for?" step: a `LocationOption` settles
> `owner_id` and `pot_id` outright.

### 🚨 There are three ways out, and they do different things

| Exit | What happens |
|---|---|
| **Save** | Writes the completion row, then clears the ticked items and collapses the list |
| **"Don't price it"** | Clears the ticked items and collapses the list, writes **no** completion row. Finishing a shop without telling the ledger about it is a legitimate outcome |
| **Cancel** (swipe, scrim, Escape) | **Nothing happens.** Same items ticked and unticked, list still open |

> 🚨 **That last one is why this sheet no longer deletes anything on open.** It is **not** an undo:
> re-inserting the items would mint new ids, and an item's identity has to stay stable or two
> devices never converge on it. **Nothing is deleted until the outcome is known**, so cancel is the
> *absence* of an action rather than the reversal of one — which means it cannot fail, and it
> survives the app being killed mid-sheet.
>
> The split is `snapshotShop()` (read-only) and `finishShop()` (the destructive half). **Keep them
> apart.**

**Details worth keeping:**

- The amount is parsed to two decimals and **rounded to pennies here** rather than trusting
  whatever the keypad produced: the ledger column is numeric and a `0.1 + 0.2` tail would be real
  money in a real account.
- A blank or zero amount is not a priced shop, so **Continue stays muted** rather than silently
  doing nothing.
- With no `joint_account` row, "Joint account" is **not offered at all** and the first Current
  Account is the default. `ensure_household()` seeds no joint account, so that is the normal solo
  case, not an edge case.
- The location picker's bracketed owner name appears only when the household has more than one
  `people` row. The other three fields are written identically whichever way the label renders.

### The confirmation, after Save

`components/ShopConfirmation.tsx`, with its rules in `lib/shopConfirmation.ts`. **Only after Save**
— never after "Don't price it" and never in a household with no ledger, because nothing went
anywhere. `Shopping.tsx` mounts it with the id `saveShopCompletion()` now resolves to, and only a
Save hands one back.

£ notes fly from a wallet (lucide's `wallet`, the icon `shared-finance-ledger`'s nav uses) to a shop,
one per 1.5s cycle. It flies **at least two, and until the ledger has answered — whichever is
later** (Adam, 2026-09-21), then morphs into its ending, holds, morphs out and closes. No buttons.

| The completion row comes back with… | Ends on |
|---|---|
| `transaction_id` | a sage tick, **"Success"** |
| `ledger_error` | a red cross, "Couldn't add to the ledger" — the retry banner (§14) is underneath |
| neither, and the phone is offline (not merely reconnecting) | a clock, "Saved — it'll reach the ledger when you're back online" |
| neither, after ~10s online | the same clock |

> 🚨 **The tick means the ledger confirmed it, and nothing else.** "Sync complete" is the row
> coming back down carrying the trigger's answer — **not** the upload queue draining, which only
> proves the row left the phone. In a shop with no signal the answer can never arrive, so a tick on
> a timer would be a lie, and the queued ending exists for exactly that. Connection state is read
> from `powerSyncDb` the same way the sync dot (§18) reads it, so the two cannot disagree.
> `scripts/verify-shop-confirmation.ts` proves every row of that table, and that no pending state
> can ever produce a tick.

**What crosses into the ledger, and what does not** — `docs/LEDGER-INTEGRATION.md` is the full
picture, but the headline: only the amount, date, category, account and the list's *name* reach
`shared_finance_ledger`. The ticked items are kept in `shop_completions.items_snapshot`, which the
trigger never reads.

---

## 10. Module: Manage lists

`components/ManageListsSheet.tsx`. Shows **every** list, hidden ones included — that is the whole
point of the sheet: a list that hides itself when empty still exists, and this is where you find
it. Create a list (including a default one), toggle default, delete, and set the list's ledger
category.

**The category is a property of the LIST, not of a shop,** which is why it is set here and not at
the till. The chip is behind the D4 gate (§5).

---

## 11. Module: Item edit

`components/ItemEditSheet.tsx`. Tap an item's text to rename, delete, or **move it to another
list**. There is deliberately no drag-between-lists: this sheet is the move mechanism.

Picking an existing list and typing a new list name are **mutually exclusive** — either would be a
destination, and allowing both would make "which wins?" a guess. Choosing one clears the other.

A move is an `UPDATE` of `list_id`, never a delete plus an insert: the row identity has to stay
stable for two devices to converge.

---

## 12. Module: House jobs and My jobs

`pages/JobsPage.tsx`. **The two pages are identical in behaviour; each has its own jobs** — so they
are **one component parameterised by `page`**.

That mirrors the backend deliberately. `house_jobs` and `my_jobs` are **two tables** rather than
one table with a `page` column, because the RLS predicate and the Sync Stream predicate genuinely
differ (household vs user) — `my_jobs` has no `household_id` at all, and that privacy is enforced
independently by the column default, the RLS policy and the stream predicate. **Two tables, one
component, on purpose.**

The page is: a heading with "N to do", an add form (name + optional due date), the open jobs sorted
by `sortOpenJobs`, and a collapsible Done section whose open/closed state is per device.

`components/JobEditSheet.tsx` edits text, due date and reminder. **The reminder checkbox appears
only when a due date is set, and clearing the date turns the reminder off** — and clearing a due
date clears `remind` in the **same SQL statement**, or the row momentarily violates its CHECK
constraint and the write is discarded silently.

---

## 13. Module: Due-soon banners

`components/DueSoonBanners.tsx`. Every **open** job on either page that is due within 3 days or
overdue gets a red banner, on **every tab**.

> It is deliberately separate from the reminder bell. **A job gets a banner whether or not its
> reminder is on.** The bell is "tell me when I'm not looking at the app"; the banner is "you are
> looking at the app, and this needs you."

Dismissal is per device and lasts for the day (§6). Editing and saving the job re-arms it.

---

## 14. Module: Ledger errors

`components/LedgerErrors.tsx` — "Couldn't add to the ledger — tap to retry", at the top of
Shopping.

> 🚨 **This component exists because the alternative is a silent failure**, and a silent failure
> here is exactly the class of bug this workstream keeps paying for: the shop was finished, the
> items were cleared, and the money never reached the ledger. With nothing on screen, the first
> anyone would know is a household budget that quietly does not add up.

The bridge trigger **never raises** — it cannot: a raising trigger blocks that device's *entire*
PowerSync upload queue, so a stale category id would stop the shopping list syncing. It records
`ledger_error` on the completion row and returns. **That column is the only signal there is**, and
this is where it surfaces.

Retry re-writes the row, which fires the trigger again. Most causes are transient or fixable — a
category that had not synced, a membership row mid-move — so trying again is usually the whole fix.

---

## 15. Module: Account and household

`components/AccountModal.tsx`.

> 🚨 **There is one link code and it belongs to the HOUSEHOLD, not to an app.** Every function
> called here is the ledger's own, unchanged. **Listly must never generate a second code, never
> offer "create a household", and never build a second linking model.** For two people already in
> one household there is nothing to do at all: signing into Listly with the same accounts shares
> Shopping and House jobs immediately.

> 🚨 **Listly never offers "Set as me".** That is `people.linked_user_id`, a **ledger** concept
> that is meaningless without a `people` row — and a `people` row carries a salary history, a pay
> cycle, pots and pensions. It is not "a user of this app". Nothing in Listly is keyed on a person:
> My jobs is keyed on the login itself, everything else on the household. Creating a `people` row
> from here would also open the D4 gate for someone with no ledger.

What is shown instead is the **signed-in email** — the honest answer to "who am I in this app",
free from the session and needing no person row. There is deliberately **no Listly display name or
profile**: that would be a third identity model alongside the login and the ledger's person rows.

The modal offers: the household's invite code (show / regenerate), Join with a code, Sign out, and
**Delete my app data** — which also deletes the caller's Listly rows (`my_jobs`,
`push_subscriptions` and `reminder_log` unconditionally, since they have no `household_id` to
cascade them; the household tables go with the household when the caller is its only member).

Code creation is guarded against React StrictMode's double-invoke: two concurrent calls to
`create_household_link_code()` race each other on its unique constraint. `linking.ts` also retries
the loser, so it is belt and braces.

> 🚩 **Known:** a race remains in `create_household_link_code()` itself — see
> `docs/LEDGER-INTEGRATION.md`.

---

## 16. Sheets and overlays

`components/Sheet.tsx` is the one implementation, and every overlay uses it.

> 🚨 **It renders through `createPortal` to `document.body`, from the very first one, and never as
> a plain `fixed`/`absolute` div inside the page.** Page components live inside a scrolling
> `overflow-y: auto` container, and an overlay inside one is clipped by it. **Bumping z-index does
> not help** (nothing is losing a stacking comparison), and switching `fixed` to `absolute` makes
> it strictly worse. A portal removes the sheet from that subtree entirely, so no ancestor's
> overflow or stacking context can reach it. This took three attempts to establish.

The sheet also: closes on **Escape**, closes on a tap of the dimmed area, and **locks `body`
scrolling while it is up**, restoring the previous value on unmount.

---

## 17. Drag reordering

`src/lib/useDragReorder.ts` — long-press-then-drag, for touch **and** mouse, showing a landing
cursor.

**The visual, and where it comes from.** The dragged row stays where it is and fades; a 3px line
shows where it would land if released now. That is My Dream Clean's diary reorder
(`.diary-drop-indicator`), which BLOC's plan page already ported (`.plan-drop-indicator`). The CSS
mirrors theirs: 3px tall, 2px radius, accent colour, with a 2px surface-coloured ring so the line
separates cleanly from whatever it sits between.

**What is deliberately NOT copied.** Both of those apps drive the drag with **HTML5
drag-and-drop** (`draggable="true"` + `ondragstart`/`ondragover`) and no touch shim. Those events
**do not fire from touch on iPhone Safari**, so that mechanism cannot work on the device Listly is
built for. **Pointer Events** are used instead — one implementation covering touch, pen and mouse —
with `setPointerCapture` so the gesture survives the finger sliding outside the row it started on.

**The gesture:**

- press and hold the grip for `LONG_PRESS_MS` → the row fades and the cursor appears;
- moving more than `CANCEL_SLOP_PX` (8px) before then cancels, so the list still scrolls normally
  under a finger that happens to start on the grip;
- releasing commits; a cancelled pointer aborts with no change.

The landing cursor is a **real element in the flow**, drawn before whichever row the dragged item
would land above — and after the last row when it would go to the end. Same mechanism as the two
apps above, which insert one shared indicator element; React just does it declaratively.

Reordering writes a `position` (a `double precision`): append gets last + 1, a mid-list insert the
midpoint of its neighbours, and **a delete never renumbers**.

---

## 18. Sync visibility: the dot and the diagnostics

`components/SyncStatusDot.tsx` is a one-glance answer to "is this actually syncing?".

> 🚨 **Why it exists.** The console showed `[PowerSync]: Sync error TypeError: Load failed` and
> there was no way to tell, from inside the app, whether that meant "sync is broken" or "a request
> was aborted during sign-out" — Safari reports both as "Load failed". **Inferring health from
> console noise is exactly how this workstream has repeatedly lost time:** the whole family of
> failures here is silent, and an app that looks fine while never syncing is the worst of them.

The state is **shown, not inferred**:

| State | Shows |
|---|---|
| connected + synced | a quiet dot, no text (the normal case) |
| downloading / uploading | "Syncing…" |
| not connected, **has** synced before | "Offline" — which is **fine**: this app is built for a shop with no signal, the queue drains later, and there is local data to work from |
| not connected, **never** synced | "Connecting…", never "Offline" |
| connected, never synced | "Connecting…" |

> That "never synced" distinction matters: signing in on the deployed build and getting an empty
> app badged "Offline" while the first download was still in flight is misleading. **"Offline"
> means "working from local data" — and before a first sync there IS no local data.**

`components/SyncDiagnostics.tsx` is the "why not?" panel behind the dot: a checklist covering
sign-in, the household, the connection, the subscriptions and the table contents.
`lib/powersync/describeSyncError.ts` turns PowerSync's error objects into something a person can
act on, and `lib/powersync/bootLog.ts` records each boot step with a timestamp so a boot that
stalls can say where.

---

## 19. The inert-control rule

> **A control with nothing to do says so BEFORE it is tapped.**

Every "add"-style control, and Finish shop, renders at `.waiting` opacity while there is nothing to
do, explains itself if tapped anyway, and **names a failed write rather than swallowing it**. A
control that silently ignores a tap is indistinguishable from a broken one — that cost three rounds
of debugging on "Add list did nothing", reported three times, with the database confirming nothing
was written and no way to tell whether the tap never landed, the field was empty, or the write
threw.

Each add path therefore does three things: states the empty-field case ("Type a list name first,
then tap Add list.", "Type an item first.", "Give the job a name first."), clears the hint on a
successful write, and catches a rejection into `Couldn't add it: <message>`.

> 🚩 **The rule is `.waiting`, unscoped.** It used to be `.btn.waiting`, which silently excluded
> the round `+` add-item button (an `.icon-btn`), so that button carried the class and got no
> styling at all for a week.

---

## 20. Icons and the icon master

`components/Icons.tsx` holds every icon as an inline SVG component — no icon library, no runtime
fetch.

**`listly-apple-touch-icon.jpg` at the repo root is the icon master. Never overwrite it.**
`public/apple-touch-icon.png`, `public/icon-192.png` and `public/icon-512.png` are all generated
from it. To regenerate: **re-measure the tile's bounding box first** (the source has a white margin
around a rounded cream tile) and crop just inside it — JPEG compression leaves a soft halo at the
edge. The corners outside the tile's radius are then filled with the tile's own cream `#F5EFE6`, so
no white shows on Android or in a browser tab, where icons are not masked to a rounded square.

---

## 21. Build, deploy and environment

```bash
npm install
npm run dev        # localhost:5173
npm run build      # tsc -b && vite build
npm run preview    # serves the built app at /listly/
npm run lint       # oxlint
npm run deploy     # builds, then publishes dist/ to gh-pages — the LIVE site
npx tsx scripts/print-sync-streams.ts   # the dashboard YAML, generated from tables.ts
```

> `npm run deploy` publishes the live site and is **never** run without being asked for in so many
> words. **There is no CI**: the `gh-pages` branch is whatever the last `npm run deploy` pushed,
> built from whatever was in the working tree at the time. Deploy from `main`, after merging.

**`.env.local` is created from the terminal, never from Finder** — macOS can silently drop the
leading dot when renaming, and Vite then ignores the file with no error at all. It holds
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POWERSYNC_URL`,
`VITE_POWERSYNC_DB_FILENAME=listly.db` and `VITE_VAPID_PUBLIC_KEY`.

**Nothing in `.env.local` should ever be a value that matters if seen.** The anon key is public by
design — RLS protects the data, not the key — and the VAPID *public* key is public by definition.
The VAPID **private** key and any email API key are Supabase secrets, set in the dashboard, and
must never reach this repo.

`VITE_POWERSYNC_DB_FILENAME` has **no default on purpose**: four apps share the origin
`adamnc02.github.io`, so they share browser storage, and Listly's local database must be
`listly.db` and nothing else. A build that forgets it should fail loudly rather than quietly
collide with another app's data.

> 🚨 **There is no Sync Streams YAML file in any repo.** PowerSync Cloud stores it server-side and
> it is edited in the dashboard; only self-hosted keeps a `sync-config.yaml`. Run the generator,
> paste the output. **Adding or removing a mirror TABLE needs a stream redeploy; adding a mirror
> COLUMN does not**, because every query is `SELECT *`.

---

## 22. What is not built yet

**Reminders (Phase 5).** The schema is already there — `push_subscriptions` and `reminder_log`
exist in the `listly` schema and are handled by `erase_my_data()` — but **there is no client-side
push code in `src/`**: no service worker registration, no `Notification` permission prompt, no
subscription write. `Job.remind` is stored, enforced and shown, and nothing yet fires against it.
`VITE_VAPID_PUBLIC_KEY` is reserved for that work.

The due-soon banners (§13) are the in-app half of the same idea and are complete.
