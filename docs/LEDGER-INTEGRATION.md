# Listly ↔ shared-finance-ledger

**This is the page to read before changing anything in `shared_finance_ledger`.**

Listly is a separate app, in its own `listly` Postgres schema, that deliberately **reuses the
ledger's household** rather than inventing one. That single decision is what makes the link code
Adam and Ella already share work for Listly too, with nothing to set up — and it is also what gives
ledger changes a blast radius they would not otherwise have.

**Nothing in Postgres or PowerSync will warn you when a change here breaks Listly.** Every failure
in the table below is silent.

**State:** Phases 1–3 complete (2026-09-20). Listly reads the ledger and depends on its functions.
The **write** path — a finished shop becoming a transaction — is Phase 4 and does not exist yet; it
is described at the end so the shape is known in advance.

---

## The blast-radius table

Every row is something a change on the ledger side could break with no error anywhere.

| `shared_finance_ledger` object | How Listly depends on it | What breaks |
|---|---|---|
| `my_household_ids()` | Every `listly` RLS policy calls it, fully qualified. It must stay `security definer` + `language plpgsql` — a `language sql` version gets inlined and loses its definer context (§21) | Rename or signature change → **every Listly table returns nothing** |
| `households(id)` | Four `listly` tables have an FK to it, `ON DELETE CASCADE` | Deleting a household deletes Listly data. Intended — but know it |
| `household_members` | **Both** Listly Sync Streams filter on it, and the §38 guard reads it through `lst_ref_household_members` | Column rename → Listly stops syncing, silently, and the guard stops protecting |
| `ensure_household()` | Called on first sign-in; Listly has no household model of its own | Signature change → Listly cannot start at all |
| `create_household_link_code()` | Listly's Account modal calls it | 🚩 It has a check-then-insert race (see below) |
| `regenerate_household_link_code()` | Same modal | May share that race — unverified |
| `redeem_household_link_code()` | Same modal, **and it carries a guarded `listly` block** (`20260920150000`) | 🚨 Rewriting it without carrying that block forward **silently destroys** a Listly user's lists and house jobs |
| `erase_my_data()` | Carries a guarded `listly` block | Same. Also the only thing that deletes `my_jobs`, which has no `household_id` and so never cascades |
| `people` (+ `linked_user_id`) | Read-only via `lst_ref_people`. The D4 gate counts it; the owner picker names it | Rename → the gate misreads and the ledger step vanishes or appears wrongly |
| `categories` (+ the `@<household_id>` suffix) | Read via `lst_ref_categories`; the id is passed through **verbatim** | Changing the suffix convention → Listly writes transactions with unresolvable categories |
| `pots`, `savings_pots`, `joint_account` | Read for the location picker. The **absence** of a `joint_account` row is meaningful | Rename → pickers empty, no error |
| `transactions` | 🚨 **Phase 4 gives this table a SECOND WRITER** | A new CHECK value or a dropped column → the shop is not booked |
| `powersync` publication, `powersync_role` | Shared by four apps | A second one → breaks everything (§6) |
| Sync Stream output names | `lst_*` / `lst_ref_*` must not collide with `sfl_*` or personal-f's bare names | A collision merges two apps' rows into one local table, silently (§32) |
| Exposed schemas | `listly` must stay listed | Removing it → every Listly `.rpc()`/`.from()` fails while sync looks perfectly healthy (§20) |

## The standing rule

🚨 **Any TABLE added to `listly` must be added to `redeem_household_link_code()` in the same
migration**, or it silently vanishes the next time anyone joins a household. That function is a
hand-maintained list and nothing checks it. (A *column* needs no such care — columns travel with
their row.)

`tools/schema-test/behaviour-listly.mjs` has 33 tests covering both functions, including a
reproduction of the data loss against the pre-migration database, and a proof that both are
unaffected on a database with no `listly` schema.

## 🚩 Known: a race in `create_household_link_code()`

Found in UAT, 2026-09-20. It does a check-then-insert against a `unique (household_id)` constraint,
so two concurrent calls both find nothing, both insert, and the loser gets `23505` raw in the UI.
Two devices opening the Account screen at once is enough.

Listly works around it client-side (`src/lib/powersync/linking.ts` retries once — by then the
winner's row exists). **The real fix is `on conflict (household_id) do nothing` then a re-select, in
the function.** Not made unilaterally because the ledger uses it too. Tracked in
`PROMPT-03-listly-ledger-bridge.md` §3a.

## What Listly never does

- **Never writes a `people` row.** It would open the D4 gate for someone with no ledger — the exact
  behaviour this design prevents.
- **Never offers "Set as me"**, and never writes `people.linked_user_id`. It reads it for one thing:
  ordering the owner picker. Nothing in Listly is keyed on a person.
- **Never writes any `lst_ref_*` table.** The connector refuses the upload and says so loudly.
- **Never creates a second household, link code or linking model.**

## The write path (Phase 4, not yet built)

One row, one way. Listly writes `listly.shop_completions` in its own schema; a `security definer`
trigger writes the `shared_finance_ledger.transactions` row server-side. That works offline and
makes a malformed ledger row impossible from a client. The `shop_completions.id` **becomes** the
`transactions.id`, so it is idempotent and traceable both ways.

Field mapping is `PROMPT-01-listly-foundations.md` §8.3. Two constraints on whoever builds it:

- 🚨 **the trigger must never `raise`** — a raising trigger blocks that device's *entire* upload
  queue, not just that row (§29), so a stale category id would stop the shopping list syncing.
  Record `ledger_error` and return.
- 🚨 **never `current_date`** — it is UTC on this project, so a shop finished at 00:30 BST books as
  `pending` instead of `cleared`. Use `(now() at time zone 'Europe/London')::date`.

Rows Listly creates are ordinary `type: 'expense'` rows needing no special handling — but **any
assumption that the ledger app created every row in `transactions` is wrong from Phase 4 onward.**
