# Listly ↔ shared-finance-ledger

**This is the page to read before changing anything in `shared_finance_ledger`.**

Listly is a separate app, in its own `listly` Postgres schema, that deliberately **reuses the
ledger's household** rather than inventing one. That single decision is what makes the link code
Adam and Ella already share work for Listly too, with nothing to set up — and it is also what gives
ledger changes a blast radius they would not otherwise have.

**Nothing in Postgres or PowerSync will warn you when a change here breaks Listly.** Every failure
in the table below is silent.

**State:** Phases 1–4 complete and UAT-signed-off (2026-09-20). Listly reads the ledger, depends on its functions, and
**writes into `shared_finance_ledger.transactions`** — live since migrations `20260920160000` and
`20260920160200`. The write path is described at the end.

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
| `pay_cycles.round_up_enabled` / `round_up_effective_from`, `pots.is_coin_jar` | Read by `round_up_state_for()`, called once per Current Account shop so Listly can round at pick time | Rename → the RPC errors, Listly falls back to its cached answer and then to "off": shops silently stop rounding |
| `round_up_state_for(text, date)` | 🚨 **Added for Listly** (`20260921220000`). The only ledger fact Listly cannot get from its own mirror | Signature change → the same silent stop |
| `transactions.rounded_from` / `rounding_pot_id` | 🚨 Listly now writes these too, **already set**. `amount` is already the rounded figure | The ledger app **re-rounding** a row that arrives with `rounded_from` set takes £9.00 out for a £7.50 shop |
| `transactions` | 🚨 **This table has a SECOND WRITER.** Listly's trigger inserts into it | A new CHECK value or a dropped column → `23514`/`42703`, caught by the trigger and shown as `ledger_error`, but the shop is not booked |
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

## The write path

**Live since `20260920160000_listly_ledger_bridge` (+ `20260920160200` for the retry).**

One row, one way. Listly writes `listly.shop_completions` in its own schema; a `security definer`
trigger writes the `shared_finance_ledger.transactions` row server-side. That works offline and
makes a malformed ledger row impossible from a client. The `shop_completions.id` **becomes** the
`transactions.id`, so it is idempotent and traceable both ways.

```
listly.write_ledger_transaction()
  BEFORE INSERT OR UPDATE OF amount, ledger_error ON listly.shop_completions
  security definer · set search_path = '' · fully qualified throughout
```

`BEFORE`, so `transaction_id` and `ledger_error` are set in the same write — an `AFTER` trigger
would need a second UPDATE, which is itself an upload.

### The exact field mapping

| `transactions` column | Value |
|---|---|
| `id` | `new.id` — the same id as the completion row |
| `household_id` | `new.household_id` |
| `user_id` | `coalesce(new.user_id, auth.uid())` |
| `date` | `coalesce(new.spend_date, London today)` |
| `amount` | `new.amount`. **A null amount books nothing** — an unpriced shop is a legitimate outcome |
| `direction` | always `'out'` |
| `type` | always `'expense'` |
| `payment_method` | `coalesce(new.payment_method, 'card')` |
| `category_id` | `new.category_id`, **verbatim, `@<household_id>` suffix intact**. Null is refused with a `ledger_error`, because the column is NOT NULL |
| `status` | `'cleared'` if `date <= London today`, else `'pending'` |
| `note` | `new.list_name` — the list name alone, "Tesco", not "Tesco shop" |
| `location` | `coalesce(new.location, 'joint')`. Never `'savings'` |
| `owner_id` | `new.owner_id`, **null when `location = 'joint'`** |
| `pot_id` | only when `location = 'pot'`. `savings_pot_id` always null |
| `rounded_from`, `rounding_pot_id` | `new.rounded_from` / `new.rounding_pot_id`, **carried verbatim** — and dropped unless `location = 'personal'` |
| `person_id`, `position`, everything else | `null` |

Before inserting it checks household membership. RLS already enforces that on `shop_completions`;
a `security definer` function bypasses RLS, so the rule is restated on the way **into** another
app's table rather than assumed.

`on conflict (id) do nothing`, so a resent upload writes once.

### The two rules it obeys, and why

- 🚨 **It never `raise`s.** A raising trigger blocks that device's *entire* upload queue, not just
  that row (§29) — a stale category id would stop the shopping list syncing. Every failure path
  records `ledger_error` and returns. Checks 6 and 12 of
  `silver-octo-invention/supabase/checks/20260920_listly_ledger_bridge_verify.sql` assert this from
  `pg_proc`, and `behaviour-listly-bridge.mjs` makes the write fail three ways and asserts the
  completion row still lands.
- 🚨 **It never uses `current_date`** — UTC on this project, so a shop finished at 00:30 BST would
  book as `pending` instead of `cleared`. Everything compares against
  `(now() at time zone 'Europe/London')::date`.

### Edits and deletes are out of scope, and a delete is permanent

Once a shop is booked it is edited **in the ledger app**. Listly is not a second editor for the same
row — that is a merge problem nobody asked for. Changing the amount in Listly does **not** rewrite
the ledger row, and there is a test asserting that so nobody "fixes" it later.

🚨 **And if you delete the transaction here, Listly will never put it back** (`20260920170000`).
Deleting it is a decision, and the bridge does not quietly undo it. The function returns early
whenever the completion already carries a `transaction_id` — read from `OLD` on an UPDATE, and
looked up **by primary key on an INSERT**, because a PowerSync upsert fires `before insert` first
with no `OLD` row. Without that second half a re-sent upload resurrected deleted transactions; it
was reproduced before it was fixed, and `behaviour-listly-bridge.mjs` scenario 11 still reproduces
it against the pre-migration function.

The completion row keeps its `transaction_id` either way, so Listly still shows the shop as priced.
That is deliberate: Listly's own history is not rewritten by a decision taken in the ledger.

The one exception is the retry. When the ledger write fails, the completion row carries
`ledger_error` and Listly shows "Couldn't add to the ledger — tap to retry".

🚨 **That retry is why the trigger also listens to `ledger_error`.** The app clears that column and
re-writes `amount` to the value it already holds — but PowerSync PATCHes only the columns that
*genuinely changed*, so what reaches Postgres is `set ledger_error = null` and nothing else. A
trigger scoped to `amount` alone would never fire, and Retry would clear the warning while booking
nothing. Nothing else ever writes that column.

### Round-ups: decided in Listly, carried by the trigger

**Live since `20260921220000`.** A £7.50 Current Account shop is booked as **£8.00** with
`rounded_from = 7.50`, and the 50p funds the **owner's** Coin Jar. Until then, Listly's insert did
not name those columns at all, so a personal card shop satisfied `shouldRoundUp` **exactly and was
silently never rounded**: the same shop was £8.00 with 50p in the jar from the ledger app, and £7.50
with nothing from Listly (found by Adam, 2026-09-21). Only **personal** shops were affected, and
joint is the default.

🚨 **The arithmetic happens in Listly, at pick time, in front of the person. The trigger carries and
computes nothing.** Two consequences a later session must not reverse:

- **There is no rounding engine in SQL**, and anything that moves the decision into the trigger
  re-introduces one — along with the possibility of a booked row that contradicts the screen.
- **The two apps agree about the purchase.** Listly stores and displays both figures, so Listly says
  "£7.50, rounded to £8.00" and the ledger says `amount 8.00, roundedFrom 7.50`.

🚨 **The ledger app must never re-round a bridge row.** It arrives with `roundedFrom` set and
`amount` already at £8.00; rounding it again takes £9.00 out for a £7.50 shop
(`APP-KNOWLEDGE.md §1.19d`). `mapping.ts` already reads the pair correctly and `potBalanceAsOf`
already folds the uplift into the jar, so **no ledger app code change was needed, and none was
made.**

🚨 **A BACKDATED Listly shop does not round** (Adam, 2026-09-21). `round_up_state_for` answers for
one date against the *current* rule and deliberately does not walk `round_up_history` — a second
implementation of `roundUpEnabledOn` in SQL is exactly the thing that drifts silently. This is a
deliberate limitation, visible in the flow (change the date and the step disappears), not a bug. A
backdated expense entered **in the ledger app** still rounds on its own date.

🐞 **Open, found in UAT 2026-09-22 — for a LEDGER developer, not a Listly one.** A Listly shop that
declined rounding carries `rounded_from = null` and **no** `round_up_skipped`, because Listly does
not store the decline. The ledger's transaction form seeds its checkbox from that flag, so the row
shows as *"will round"* and an unrelated edit re-saves it **rounded** — a declined £4.25 becomes
£5.00. This is the one place the two apps' models genuinely disagree, and it is tracked in
`shared-finance-ledger/PROMPT-13a-round-up-ui-fixes.md` §0.2, where one of the two candidate fixes
is for Listly to store the decline after all.

**Whose jar:** the `owner_id` of the **picked location**, never the signed-in user. In a two-person
household Ella's Current Account shop rounds into **Ella's** jar, gated on **her** switch. Joint and
pot shops never round, and the trigger drops a pair that somehow arrives on one.

### What is kept in Listly and never sent

`shop_completions.items_snapshot` — a newline-separated snapshot of the ticked item names. **The
trigger never reads it**, so no item detail can reach `shared_finance_ledger` (Adam, 2026-09-20:
*"only amount needs to be recorded"*).

Rows Listly creates are ordinary `type: 'expense'` rows needing no special handling — but **any
assumption that the ledger app created every row in `transactions` is now wrong.**
