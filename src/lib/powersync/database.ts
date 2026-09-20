import { PowerSyncDatabase, WASQLiteVFS } from '@powersync/web'
import { AppSchema } from './schema'
import { SupabaseConnector } from './connector'

/**
 * The PowerSync database singleton.
 *
 * OPFSCoopSyncVFS, not the default VFS: PowerSync's own docs flag the default
 * as unreliable for multi-tab Safari/iOS, and Listly is an iOS PWA — that is
 * where it will spend its entire life.
 *
 * 🚨 dbFilename MUST differ per app. OPFS is per ORIGIN, and personal-f, both
 * ledger apps and Listly all live on adamnc02.github.io. Two apps sharing a
 * file would each read, and upload, the other's rows. There is deliberately
 * NO default: a build that forgets VITE_POWERSYNC_DB_FILENAME should fail
 * loudly rather than quietly collide with another app's data.
 */
export const POWERSYNC_DB_FILENAME = import.meta.env.VITE_POWERSYNC_DB_FILENAME

const OTHER_APPS = ['personal-finance.db', 'shared-finance-ledger.db', 'finance-ledger-test-sync.db']
if (!POWERSYNC_DB_FILENAME) {
  throw new Error('VITE_POWERSYNC_DB_FILENAME must be set (listly.db). See the README.')
}
if (OTHER_APPS.includes(POWERSYNC_DB_FILENAME)) {
  throw new Error(
    `VITE_POWERSYNC_DB_FILENAME is ${POWERSYNC_DB_FILENAME}, which belongs to another app on this ` +
      'origin. Listly must use listly.db or it will read and overwrite that app\'s rows.',
  )
}

export const powerSyncDb = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: POWERSYNC_DB_FILENAME, vfs: WASQLiteVFS.OPFSCoopSyncVFS },
})

export const powerSyncConnector = new SupabaseConnector()

/** Listly's two streams. Both auto_subscribe: false; subscribed explicitly. */
export const LISTLY_STREAM = 'listly_household'
export const LISTLY_REF_STREAM = 'listly_ledger_ref'
