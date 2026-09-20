# Listly — design brief & specification

Companion to `listly-prototype.html`, a clickable prototype you can open in any browser. The prototype shows the agreed look and behaviour. It holds sample data in memory, so nothing is saved.

## 1. What Listly is

Listly is a personal mobile app (PWA-style, phone-first) for three things:

1. **Shopping**: one checklist per shop.
2. **House jobs**: jobs around the house, with optional due dates and reminders.
3. **My jobs**: personal jobs. It works the same way as House jobs but is a separate list.

Navigation is a bottom tab bar with three tabs: **Shopping**, **House jobs** and **My jobs**.

## 2. Shopping page

### Lists
- Each shop has its own list. The list name is free text; typical names are Tesco, M&S, Pets at Home and Costco, but any name works.
- Lists expand and collapse by tapping the header. The header shows the list name, a star if it's a default list, and a count pill ("3 to get", "all got" or "empty").
- **Add list:** a dashed "New list, e.g. Tesco" box at the bottom of the page creates a non-default list.

### Default vs non-default lists
| | Default list (★) | Non-default list |
|---|---|---|
| Shown when it has items | Yes | Yes |
| Shown when empty | **Yes, always** | **No, hidden** |
| After "Finish shop" leaves it empty | Stays, empty | Becomes hidden (it isn't deleted) |

- A list you've just created is shown even though it's empty, so you can add its first items. Once it has had items and is emptied, the normal hide rule applies.
- A hidden list still exists. It still appears in **Manage lists** and as a "Move to" target, and it reappears as soon as an item is moved into it.

### Manage lists (button in the Shopping page header)
The button opens a bottom sheet listing **every** list, hidden ones included. Each row shows:
- a **star toggle** that makes the list a default (or stops it being one)
- the list name and a status: "3 items", "empty · always shown" or "empty · hidden"
- a **delete** button. If the list still has items, it asks for confirmation first.

The sheet also has an **"Add a default list"** input.

### Items
- Each item has a checkbox to tick it off while you shop. Unticked items are fine, for example when something was out of stock.
- **Drag to reorder** items within a list using the grip handle. The prototype uses desktop mouse drag; **the real build needs touch drag** (e.g. long-press, then drag).
- There's no dragging between lists. Instead, **tapping an item's text** opens an edit sheet where you can:
  - rename it
  - delete it
  - **move it** to another existing list (chips), or type a new list name to create that list and move the item there. The new list is non-default.
- Items are added with an "Add an item…" field at the bottom of each open list. Pressing Enter or the + button adds the item.

### Finish shop
Each open list with items has a **Finish shop** button. It removes all ticked items and collapses the list. Unticked items stay for next time. A hint line above the button says what will happen, e.g. "2 unticked will stay for next time".

## 3. House jobs & My jobs pages

The two pages are identical in behaviour; each has its own jobs.

- **Add a job:** a text field and an optional **Due** date, then Add.
- **Open jobs:** jobs with a due date come first, soonest first, followed by jobs with no date. Each job shows a checkbox, its text and a due chip ("Due tomorrow", "Due in 3 days · Wed 23 Sept", "Due Sat 10 Oct", "Overdue by 2 days"). The chip turns red when the job is due within 3 days.
- **Reminder bell:** shown **only when the job has a due date**. Tapping it turns the reminder on or off; when on, the bell is white on a sage circle. The edit sheet has the same setting as a "Remind me about this job" checkbox, which also appears only when a due date is set. Removing the due date turns the reminder off.
- **Ticking a job** moves it into a collapsed **Done** section, which shows a count. You can untick a job there to bring it back.
- **Tapping a job** opens an edit sheet with its text, due date, reminder and a delete button.

## 4. Due-soon banner (whole app)
- Any **open** job, on either jobs page, that is **due within 3 days or overdue** shows a **big red banner** at the top of the app, under the header, on every tab.
- Each banner shows the job text and a line such as "House job · Due tomorrow" or "My job · Due in 2 days".
- Each banner has its own dismiss (✕) button. Editing and saving the job re-arms its banner.
- The banner is separate from the reminder bell: every job due soon gets a banner, whether or not its reminder is on.

## 5. Visual design

### Colours (taken from the logo)
| Token | Hex | Used for |
|---|---|---|
| `--ground` | `#F5EFE6` | App background (cream, matches the logo tile) |
| `--paper` | `#FFFCF7` | Cards, sheets, tab bar |
| `--ink` | `#3B2F26` | Main text |
| `--muted` | `#7A6A5C` | Secondary text, hints |
| `--soft` | `#5E4F43` | Labels, Done header |
| `--brown` | `#8A5E34` | Page titles, primary buttons, active tab, default star (the logo's house) |
| `--brown-2` | `#7A5430` | Inactive tab text, due chip text |
| `--sage` | `#6F8C5E` | Ticked boxes, add/save buttons, reminder on (the logo's leaf) |
| `--sage-light` | `#A9BB9C` | Unticked checkbox outline |
| `--sage-wash` | `#EDF2E6` | Count pills, drag-over highlight |
| `--line` | `#E6DCCD` | Card borders, dividers |
| `--line-2` | `#D9CBB8` | Input underlines, dashed "add" boxes |
| `--red` | `#B3362C` | Due-soon banner, delete actions |
| due-soon chip | `#FBE6E3` bg / `#9E2A21` text | Red due chips |
| due chip | `#F1E6D7` bg / `#7A5430` text | Normal due chips |
| done card | `#EFE7DB` | Done section background |
| done text | `#8C7C6E` / `#7E6E60` | Ticked items / done jobs (struck through) |

### Typography
- **Font:** [Caveat](https://fonts.google.com/specimen/Caveat) (Google Fonts), weights 400–700, used for **all** text. It gives a readable handwritten fountain-pen look. Alternatives considered: Kalam, Patrick Hand.
- Handwriting fonts run small, so sizes are generous:
  | Use | Size / weight |
  |---|---|
  | App name "Listly" | 36px, 700 |
  | Page titles | 34px, 700 |
  | Sheet titles | 32px, 700 |
  | List names | 30px, 700 |
  | Items and jobs | 26px, 400 |
  | Buttons | 22px, 700 |
  | Tab labels | 21px, 700 |
  | Chips and hints | 18–20px |

### Shape and layout
- Cards and banner: 16–18px radius, 1.5px `--line` border. Bottom sheets: 26px top radius.
- Checkboxes: 26px rounded squares (8px radius), 2.4px border, white tick when checked.
- Pills and buttons are fully rounded. Touch targets are at least 44px.
- The header has the logo (46px, 13px radius) and "Listly", with today's date underneath (e.g. "Sunday 20 September").
- The tab bar has three equal tabs, each an icon above a label. The active tab is filled brown with white text.
- Icons are simple line icons (2px stroke, rounded caps): basket, house, person, bell, star, trash, chevron, grip.
- Edits happen in bottom sheets over a dimmed background, `rgba(59,47,38,.4)`.

### Logo
A rounded-square tile on a cream background with a brown line-drawn house and a green leaf/"L" stroke. It's embedded in the prototype HTML as base64. Use the original file for app icons.

## 6. Data model (as prototyped)
```
List { id, name, isDefault: bool, open: bool, items: Item[], fresh?: bool }
Item { id, text, done: bool }            // order = array order (drag-reorderable)
Job  { id, page: 'house' | 'mine', text, due: 'YYYY-MM-DD' | '', remind: bool, done: bool }
UI   { tab, dismissedBanners: {jobId: true}, doneOpen: {house, mine} }
```

## 7. Open questions for scoping
- **Storage and sync:** local-only on the device, or a backend so it syncs across devices? Should lists or house jobs be **shared with another person**? If so, My jobs would stay private.
- **Reminders:** how and when should they fire? Options include a push notification on the due date or the day before, a user-chosen time, or repeats until done. Push on iOS needs the PWA added to the Home Screen.
- **Dismissed banners:** should a dismissal persist, or reappear the next day or at next launch?
- **Touch drag:** how reordering should work on a phone (long-press, then drag).
- **Recurring jobs** (e.g. yearly insurance renewal)? Not in the prototype.
- **Hosting, install and offline support** for the PWA.
