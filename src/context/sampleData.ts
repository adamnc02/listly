import type { Job, List } from '../types'
import { parseLocalDate, toLocalIsoDate, todayIso } from '../lib/date'

/**
 * PHASE 1 ONLY. The prototype's sample data, so the UI can be driven and
 * signed off before any backend exists.
 *
 * 🚨 This file is DELETED in Phase 3, when PowerSync becomes the source of
 * data. It must never become "seed data" for a real household: seeding a
 * synced table from a device is exactly the write a pre-sync device must
 * never make, and it would land on Ella's phone as a set of lists neither
 * of them created.
 */

const inDays = (n: number): string => {
  const d = parseLocalDate(todayIso())
  d.setDate(d.getDate() + n)
  return toLocalIsoDate(d)
}

export const sampleLists: List[] = [
  {
    id: 'l1',
    name: 'Tesco',
    isDefault: true,
    createdAt: todayIso(),
    neverHadItems: false,
    items: [
      { id: 'i1', text: 'Semi-skimmed milk', done: true },
      { id: 'i2', text: 'Sourdough loaf', done: false },
      { id: 'i3', text: 'Bananas', done: false },
      { id: 'i4', text: 'Chicken thighs', done: true },
      { id: 'i5', text: 'Washing-up liquid', done: false },
      { id: 'i6', text: 'Mature cheddar', done: false },
    ],
  },
  {
    id: 'l2',
    name: 'M&S',
    isDefault: true,
    createdAt: todayIso(),
    neverHadItems: false,
    items: [
      { id: 'i7', text: 'Salmon fillets', done: false },
      { id: 'i8', text: 'Flowers', done: false },
    ],
  },
  { id: 'l3', name: 'Pets at Home', isDefault: true, createdAt: todayIso(), neverHadItems: false, items: [] },
  {
    id: 'l4',
    name: 'Costco',
    isDefault: true,
    createdAt: todayIso(),
    neverHadItems: false,
    items: [
      { id: 'i12', text: 'Kitchen roll', done: false },
      { id: 'i13', text: 'Coffee beans', done: false },
      { id: 'i14', text: 'Olive oil', done: false },
    ],
  },
  {
    id: 'l5',
    name: 'B&Q',
    isDefault: false,
    createdAt: todayIso(),
    neverHadItems: false,
    items: [
      { id: 'i15', text: 'Fence paint', done: false },
      { id: 'i16', text: 'Hinges for gate', done: false },
    ],
  },
  { id: 'l6', name: 'Boots', isDefault: false, createdAt: todayIso(), neverHadItems: false, items: [] },
]

export const sampleJobs: Job[] = [
  { id: 'j1', page: 'house', text: 'Renew car insurance', due: inDays(1), remind: true, done: false },
  { id: 'j2', page: 'house', text: 'Book boiler service', due: inDays(3), remind: false, done: false },
  { id: 'j3', page: 'house', text: 'Fix the garden gate', due: inDays(20), remind: false, done: false },
  { id: 'j4', page: 'house', text: 'Clear the gutters', due: '', remind: false, done: false },
  { id: 'j5', page: 'house', text: 'Change smoke alarm batteries', due: '', remind: false, done: true },
  { id: 'j6', page: 'mine', text: 'Renew gym membership', due: inDays(2), remind: true, done: false },
  { id: 'j7', page: 'mine', text: 'Renew passport', due: inDays(40), remind: false, done: false },
  { id: 'j8', page: 'mine', text: 'Sort out pension paperwork', due: '', remind: false, done: false },
]
