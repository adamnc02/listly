# Listly — architecture

How the app is put together, and why. **State: Phases 1–4 complete (2026-09-20).** The ledger bridge
is live; reminders (Phase 5) are not built.

---

## The shape

```
AuthProvider            session: undefined | null | Session
 └─ AuthGate            sign-in. The FIRST screen; there is no guest mode
 └─ SyncRoot            ensure_household → §20 smoke test → subscribe → connect → §38 guard
     └─ ListlyProvider  watched queries in, narrow SQL out
         └─ Shell       header · due-soon banners · the current tab · tab bar
```

**`ListlyContext`'s interface has not changed since Phase 1**, when the data was in memory. That was
the point of putting the boundary there: `useState` became watched queries and the mutators became
narrow SQL, and no page, sheet or component needed touching. Keep it that way — a component that
reaches past the context into PowerSync directly forfeits that.

## Sign-in is required, and there is no guest mode

Not a product preference. In this stack, signing in for the first time makes all pre-existing local
data **silently invisible** (MIGRATION-LESSONS §24) — it cost a family member's data on another app
here. Listly avoids it entirely by never having pre-auth data to lose.

**Do not add a local-only mode later.** If it ever seems necessary, the `LegacyDataMigration`
equivalent has to be built in the same change, before anyone signs in.

## The sync layer

### `tables.ts` is the one list

`schema.ts` builds the local PowerSync schema from it, `connector.ts` maps local names back to
Postgres, and `scripts/print-sync-streams.ts` prints the dashboard YAML from it. Those three cannot
drift apart, which matters because **PowerSync names the local SQLite table after the query's
alias** — a mismatch returns zero rows forever, with no error (§7, §32).

🚨 **There is no Sync Streams YAML file in any repo.** PowerSync Cloud stores it server-side and it
is edited in the dashboard; only self-hosted keeps a `sync-config.yaml`. Run the generator, paste
the output.

### Two prefixes, meaning different things

| Prefix | What | Written? |
|---|---|---|
| `lst_` | Listly's own tables, in the `listly` schema | yes |
| `lst_ref_` | A read-only mirror of **five** small `shared_finance_ledger` tables | **never** |

The mirror exists so the D4 gate and every picker work standing in a shop with no signal. It is
deliberately **not** the ledger's own 27-table stream: Listly has no business holding loans and
salary history. The connector refuses to upload a `lst_ref_` table and says so loudly.

`people`, `categories`, `pots`, `joint_account` and `household_members`. **`savings_pots` was
dropped on 2026-09-20** (Adam): the location picker excludes savings pots by design, matching the
ledger's own ad-hoc entry, so it was dead data. That was a change to what Listly *subscribes to* —
`shared_finance_ledger.savings_pots` is untouched. Removing it needed a dashboard redeploy of the
`listly_ledger_ref` stream, which is the general rule: **adding or removing a mirror TABLE needs a
stream redeploy; adding a mirror COLUMN does not**, because every query is `SELECT *`.

Four apps share the origin `adamnc02.github.io` and one login. personal-f's stream is
auto-subscribed and outputs **bare** names; the ledger's outputs `sfl_`. Audited 2026-09-20: **45
distinct output names across all four streams, no collisions.** Re-run that audit whenever a stream
changes.

### 🚨 Subscribe BEFORE connect

`connect()` with `includeDefaultStreams: false` and no subscriptions gives PowerSync nothing to
sync, so the connection never completes and `await connect()` **never resolves** — no error, no
timeout, and a status that reads "not connected, no error". This cost an evening on 2026-09-20.
`PROMPT-01` §9.3 documents connect-then-subscribe; that ordering is wrong for a client with no
auto-subscribed streams, and Listly has none by design.

`includeDefaultStreams: false` is itself load-bearing: personal-f's stream is `auto_subscribe: true`
and would otherwise land here.

### The boot never blocks on the network

Only `ensure_household()` and the §20 schema smoke test are awaited, each with a 20-second timeout.
Connect, the subscriptions and the §38 guard happen **behind the rendered app**. This is an
offline-first app whose whole point is working with no signal; blocking the first paint on a network
call was backwards, and it also hid failures, because a step that never resolves and never throws
cannot report itself.

### 🚨 The §38 guard

The household can change under an open device — a partner redeems a link code, or runs "Delete my
app data". A device open throughout still holds the old household id and will write rows stamped
with it.

When the old household is *gone*, RLS refuses those writes. **The dangerous case is when it still
exists** (a partner remained, or a redeem moved you): RLS then *accepts* them and **brings deleted
data back**. That is the live incident §38 records.

So `SyncRoot` reads membership from synced `lst_ref_household_members` on every delivery and
**suspends** — unmounting its children so nothing can write — the moment the user is missing from
the session's household or appears in a different one. A brand-new household whose membership row
has not synced yet is not treated as lost.

### Writes

Every `UPDATE` is **narrow**, setting only what changed, because PowerSync resolves conflicts per
column — that is what lets two phones edit the same list at once. A "write the whole row" helper
would destroy it everywhere at once, so there isn't one.

- Deletes go **child-first**; inserts parent-first (§27).
- Moving an item between lists is an `UPDATE` of `list_id`, never a delete plus an insert — the row
  identity has to stay stable for two devices to converge.
- Clearing a due date clears `remind` in the **same** statement, or the row momentarily violates its
  CHECK and the write is discarded silently.
- `user_id` is never sent: it defaults to `auth.uid()` server-side.

### The mapping boundary

`'' ↔ NULL` both ways for id-shaped columns. Booleans arrive as 0/1 — `bool()` accepts every honest
representation, because a boolean misread as `false` is not a crash, it is a row quietly vanishing
from the UI. Positions are `double precision`, appended after the last sibling or the midpoint of
two neighbours, and **never renumbered on delete**.

**There is no `jsonb` anywhere in this schema**, which is what makes §33 impossible here rather than
merely avoided. Keep it that way.

## Per-device state is not data

Which lists are expanded, which banners are dismissed, which Done sections are open — all
`localStorage`, never columns (Adam, 2026-09-20). Syncing them would mean one partner collapsing the
Tesco list collapses it on the other's phone mid-shop. `src/lib/deviceState.ts` is where that
decision lives; every read and write is wrapped in try/catch and falls back to defaults.

## Diagnosing it when it breaks

**Everything in this stack fails silently.** The app therefore carries its own diagnosis rather than
expecting anyone to read a console:

| Tool | What it answers |
|---|---|
| The sync dot (header) | connected / syncing / offline / failed, with `lastSyncedAt` on hover |
| Tap it → **Sync check** | signed in? token valid? server reachable? **does the server accept the token?** what does PowerSync think? |
| **Startup steps** in that panel | exactly which boot step was reached, and where it stopped |
| `describeSyncError()` | turns OPFS and network shrugs into sentences a person can act on |

🚨 **Multi-tab.** PowerSync disables multi-tab support by default on **Safari, iOS and Android**, so
only one tab can hold the database. A second tab gets a `DOMException: UnknownError` — reported as
"unknown transient reason (e.g. out of memory)", which is neither. Irrelevant in production (an
installed PWA is one instance); it bites in desktop testing.

**For "did a write actually happen?", use the row counters** — no RLS access needed, no personal
data exposed:

```sql
select relname, n_tup_ins, n_tup_upd, n_live_tup
from pg_stat_user_tables where schemaname = 'listly' order by relname;
```

## Dates

`src/lib/date.ts` is a **byte-identical** copy of the ledger's, left unannotated so a `diff` proves
it has not drifted. Never `toISOString().slice(0,10)` (rolls the date back a day during BST) and
never `new Date('YYYY-MM-DD')` (parses as UTC midnight and compares as *later* than a local-midnight
date for the same day). Both are live bugs the ledger already paid for.

In SQL, never `current_date` — it is UTC on this project. Use `(now() at time zone 'Europe/London')::date`.

## Overlays

Everything goes through `src/components/Sheet.tsx`, which portals to `document.body`. Page
components render inside an `overflow-y: auto` container and a bare `fixed`/`absolute` overlay is
clipped by it; neither a z-index bump nor switching to `absolute` helps (§15, three attempts on
personal-f). Sheet children are `flex-shrink: 0` — without it, taller-than-sheet content is squashed
instead of scrolled.

---

## The ledger bridge

One row, one way, and it is worth understanding before touching either side.

With **no ledger**, finishing a shop clears the ticked items and collapses the list — the same thing
it has always done.

With a ledger, Finish shop **changes nothing yet**. It opens a stepped sheet asking three things
(amount, date, location), and there are three ways out:

| | Ticked items | Ledger row |
|---|---|---|
| **Save** | cleared, list collapses | written |
| **"Don't price it"** | cleared, list collapses | none |
| **Cancel** (swipe, scrim, Escape) | **untouched** | none |

🚨 **Cancel is not an undo, and that is deliberate.** Nothing is deleted until the outcome is known,
so cancelling is the *absence* of an action. Implementing it as "delete on open, restore on cancel"
would have meant re-inserting the items — which mints new ids and breaks invariant 1 (an item's
identity must stay stable or two devices never converge on it), and would have to survive the app
being killed mid-sheet. Deferring costs nothing and cannot fail.

That is why the context exposes `snapshotShop()` (read-only) separately from `finishShop()` (the
destructive part). A caller that opens the sheet must use the first.

Once the outcome is known, one row goes to `listly.shop_completions`. A trigger on that table,
inside the database, writes the `shared_finance_ledger.transactions` row.

**Why server-side rather than a second client write:** it works offline, it cannot produce a
malformed ledger row from a client, and it needs no second round trip. The app writes to its own
schema and the database does the rest.

**The gate is `select 1 from lst_ref_people limit 1`** — read from the local mirror, so it costs no
request and works with no signal, and re-evaluated on every sync delivery, so the price step appears
the moment a `people` row does. It is deliberately **not** a category count:
`ensure_household()` seeds 35 categories into every household, so a count is never zero.

**The failure signal is a column, not an exception.** The trigger can never `raise` — that would
block the device's whole upload queue — so `shop_completions.ledger_error` is the only way to know a
shop did not reach the ledger. It syncs down and the Shopping page renders it with a Retry.

Full detail, including the exact field mapping and the blast-radius table, is in
[`LEDGER-INTEGRATION.md`](LEDGER-INTEGRATION.md). It is the page a *ledger* developer reads.

---

## The app shell, and why the nav floats

`html`, `body` and `.app` are all sized from one JS-measured `--app-height`, and the page itself
does not scroll — only `<main>` does. Ported from BLOC, which paid for it on real hardware.

🚨 **The non-obvious part:** `position: fixed` on iOS standalone relies on WebKit's *own* internal
sense of the viewport, which is stale on first paint until a real scroll forces a recompute. Locking
the page removes the scroll that used to accidentally hide that. So the bottom nav is
`position: absolute`, anchored to `.app` — it follows normal layout against a box driven by the same
measured value as everything else.

It is also a **pill inset 12px each side**, not a full-bleed bar, because a full-bleed bar's bottom
corners collide with the device's own rounded screen corners and it cannot render its own height
safely.

The z-index contract, which any new overlay must respect:

| Layer | z-index |
|---|---|
| scrolling content | 0–2 |
| edge fades | 50 |
| floating nav | **100** |
| modal overlays (`.sheet-root`) | **500** |
| the sync-error banner | 400 |

Every overlay goes through `Sheet`, which portals to `document.body`. Verified by screenshot on
2026-09-20 rather than reasoned about — see `APP-KNOWLEDGE.md`.
