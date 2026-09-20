import { column, Schema, Table } from '@powersync/web'
import { SYNCED_TABLES, localName, type ColumnKind } from './tables'

/**
 * The local PowerSync schema, built from tables.ts so it cannot drift from
 * the list the connector and the Sync Streams YAML use.
 *
 * No `id` column is declared: PowerSync adds it. Booleans are stored as
 * integers (0/1) and converted at the mapping boundary.
 */
const COLUMN = {
  text: column.text,
  real: column.real,
  integer: column.integer,
  bool: column.integer,
} satisfies Record<ColumnKind, unknown>

export const AppSchema = new Schema(
  Object.fromEntries(
    SYNCED_TABLES.map((spec) => [
      localName(spec),
      new Table(
        Object.fromEntries(Object.entries(spec.columns).map(([name, kind]) => [name, COLUMN[kind]])),
      ),
    ]),
  ),
)
