import { customAlphabet } from 'nanoid'

/**
 * Client-generated row ids, the same shape shared-finance-ledger uses:
 * an 8-character nanoid over an unambiguous alphabet (no 0/O/1/I).
 *
 * PowerSync syncs exactly one TEXT `id` per row and supports no composite
 * keys, so every Listly table's primary key is one of these
 * (PROMPT-01 §5).
 *
 * 🚨 MIGRATION-LESSONS §36: anything a device generates WITHOUT a user
 * action needs a DETERMINISTIC id instead of one of these, or two devices
 * create two rows for the same real thing and nothing errors. Every call
 * to `newId()` in this app is behind a deliberate tap — adding a list, an
 * item or a job. `reminder_log`'s id is derived, not random, for exactly
 * this reason (§5.6).
 */
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 8)

export function newId(): string {
  return nanoid()
}
