# EDMO Collab Dashboard — Project Context for Claude Code

**This is a clone of PMDAMC** (taken 4 Nov 2026), re-branded as EDMO Collab
Dashboard. Everything below describes the shared codebase. It was written
for PMDAMC, so "DAMC" and "the Chief" in it refer to the original client.
The conventions apply here unchanged.

**Branding lives in exactly two files: `backend/src/brand.js` and
`frontend/src/brand.js`.** Never hard-code the product or organisation name
anywhere else. That is how this clone was made, and how any future
re-brand stays a one-file change.

- Browser storage keys use `edmo.` / `edmo_` (PMDAMC uses `pmdamc.` /
  `tfh_`), so the two apps never share a sign-in on one computer. If you add
  a key, use the `edmo` prefix. The pre-paint script in `index.html` reads
  `edmo.appearance`.
- The default accent's stored id is still `"damc"`. It is a data value, also
  in a DB CHECK constraint. Only its label comes from `BRAND.shortName`.
- It must run on its own database, with its own `JWT_SECRET`.


Read this fully before making changes. It captures decisions and conventions
that aren't obvious from the code alone.

## What this is

A full-stack project management tool built for DAMC (Department of
Agriculture Marketing and Cooperatives), Bhutan. Multi-workspace,
multi-project task management with realtime updates.

## Tech stack

- **Backend**: Node.js + Express + Socket.IO + Postgres (`pg` pool, raw SQL,
  no ORM), multer for file uploads to local disk
- **Frontend**: React (Vite) + socket.io-client + recharts + lucide-react,
  single `App.jsx` file (~3800 lines) — most components live in this one
  file by established convention, don't split it apart without being asked
- **Database**: Supabase-hosted Postgres in production, plain Postgres
  locally
- **Deploy**: Backend on Render (Web Service), frontend on Render (Static
  Site) or Vercel — both have been used across different sessions

## Critical: schema.sql is append-only and idempotent

`backend/db/schema.sql` is the single migration file — there is no
migrations folder with numbered files. Every change goes at the END of this
file, using `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT
EXISTS`, etc. It must be safe to run against a database at ANY previous
version, including fresh. `npm run migrate` runs it in an explicit
transaction (BEGIN/COMMIT/ROLLBACK on one client) — this was a deliberate
fix after discovering the simple-query-protocol approach wasn't reliably
atomic. Don't revert that.

**A real, previously-hit bug worth knowing about**: any `information_schema`
query MUST filter `table_schema = 'public'` explicitly. Supabase's built-in
`auth.users` table also has columns like `role`, and an unfiltered query can
silently match the wrong table across schemas.

## Permission model (this has changed multiple times — current state matters)

Three workspace-level roles: `admin`, `lead`, `member`. Plus **per-project
leads** (`projects.lead_id`) — a project can have its own lead distinct from
the workspace-wide lead, with manager-level rights scoped to just that
project. The `isManager(req)` helper in `tasks.routes.js` checks: workspace
admin/lead, OR `req.project.leadId === req.user.id`.

**Current rules for a plain member** (not admin, not workspace lead, not
that project's lead). The pivot is **"is this task mine?"**, defined in one
place as `task.assigneeId === me || task.createdBy === me`:
- Can view every task in a project (not just their own)
- Can create a new task (title, description, subtasks, priority, assignee,
  due date, AND stage files/links to upload immediately after creation)
- Can comment on any task
- Can **edit** a task that is theirs — every field except the assignee.
  Reassigning is a management decision and stays manager-only even on your
  own task.
- Can **delete** only a task they CREATED. A task someone else assigned to
  them can be edited and completed, but not deleted (`canDeleteTask` in
  tasks.routes.js, `canDelete` in TaskDialog). Managers (admin, workspace
  lead, project lead) can delete any task.
- Can add/remove files and links on a task that is theirs.
- Can do NONE of the above on a task that is neither assigned to them nor
  created by them — work between two other people. That is the case the rule
  exists to protect; don't collapse it to "any task in the workspace".

The frontend's `isOwnTask` in `TaskDialog` and `saveDraft`, and the server's
checks in the PATCH and DELETE handlers, must all use that same definition.
If they drift apart a member gets an editable form whose save is refused.

Bulk-add (`POST /tasks/bulk`) stays admin/lead/project-lead only — it was
never reopened to members even when single-task creation was.

If asked to change member permissions again, check `tasks.routes.js`
`isManager` and `canTouchTask` first — this is where every boundary lives.
Don't assume; the rules have flip-flopped across sessions based on evolving
client requirements, so verify current state by reading the code, not by
assuming from a past description.

## "Assigned by" is shown only when it isn't you

`TASK_SELECT` exposes `createdByName` beside `createdBy`. `AssignedByChip`
resolves the person from the roster in `ViewerContext` (a context, not a
prop — the chip appears on rows rendered from half a dozen places and
threading it through every one is the kind of change that gets forgotten in
exactly one spot).

**The hide rule is `createdBy === assigneeId`, NOT `createdBy === viewerId`.**
Those are the same thing on your own dashboard and different everywhere else,
and the viewer-based version shipped first and was wrong: it hid the
attribution in the Team column, which is precisely where a supervisor needs
to see that he is the one who gave that task out. The question the chip
answers is "did this person enter their own work?", which is a fact about the
task, not about who is reading it. Don't "improve" it by always showing it
either: self-entered work stays unlabelled.

## Recurring activities — occurrences are real rows, not virtual

`tasks.recurrence` (JSONB) holds the repeat rule and lives ONLY on the first
task of a series ("the head", `recurrence_parent_id IS NULL`). Every later
occurrence is an ordinary task row pointing back at the head via
`recurrence_parent_id`. This was chosen deliberately over computing
occurrences on read: they have to be individually completable, assignable,
commentable and attachable, and this way the board, calendar, dashboard and
the due-soon reminder sweep all handle them with zero changes.

- Rule shape and expansion: `backend/src/utils/recurrence.js`. All date
  maths is on `'YYYY-MM-DD'` strings via **UTC noon** Date objects — these
  are calendar dates, not instants, and noon is what stops a server
  timezone from shifting a date by a day. Monthly anchors on the ORIGINAL
  day-of-month, so a series starting on the 31st doesn't degrade to the
  28th permanently after one February.
- Generation: `backend/src/utils/recurrenceRunner.js`, 60-day horizon, run
  inline after a save AND on an hourly sweep (same pattern as
  `reminders.js`). It is idempotent, backed by the partial unique index
  `uq_tasks_recurrence_occurrence (recurrence_parent_id, due)` — two
  overlapping sweeps cannot race a duplicate through.
- Editing a rule deletes only **untouched** future occurrences
  (`deleteUntouchedFutureOccurrences`: still `todo`, no comments, no
  attachments, no ticked subtasks) and regenerates. Never widen that filter
  to "all future occurrences" — it would silently destroy work someone has
  already done.
- Deleting a series head calls `promoteNextSeriesHead` FIRST, because
  `recurrence_parent_id` cascades — without the promotion, deleting the
  first activity would take the whole series with it.
- **Exception dates are what make deletion stick.** `tasks.recurrence_exdates`
  (DATE[], on the head) lists dates the generator must never recreate.
  Deleting an occurrence records its date there. Without this the sweep saw
  a "missing" date in the series and refilled it, so a deleted activity came
  straight back and the whole series looked impossible to remove — a real
  bug reported from production. Never generate without filtering `exDates`,
  and carry the array across in `promoteNextSeriesHead`.
- `PATCH` with a `recurrence` OBJECT on a non-head task is rejected (400):
  a schedule needs the series' own start date as its anchor. But
  `recurrence: null` from an occurrence IS accepted and stops the series via
  its head — "Stop repeating" has to work from whichever occurrence the user
  happens to be looking at, because they don't know which one is first.

## Dates are always dd/mm/yyyy — never use a bare `<input type="date">`

A native date input renders in the BROWSER's locale, so the same field shows
`09/15/2026` to one person and `15/09/2026` to another and the markup can't
control it. This office reads day-first, and the US order was a real source
of misreading. Every date input in the app therefore uses the `DateField`
component in `App.jsx`: a text input we format ourselves (always
dd/mm/yyyy, tolerant of `5/9/26` and `5-9-2026` on input, rejects
impossible dates like 31/02), plus a calendar button that opens the native
picker via `showPicker()` with a `.click()` fallback. The native input is
still in the DOM but is 1px and transparent — it drives the picker and
never renders the value.

If you add a date field, use `DateField`. A raw `type="date"` will silently
be US-formatted for some users. The only legitimate `type="date"` in the
codebase is the hidden one inside `DateField` itself.

**The same rule applies to DISPLAYING a date, not just to inputs.**
`toLocaleDateString` orders by the browser's locale, so the same agenda
heading reads "30 Sept" for one person and "Sept 30" for another. `shortDate`
and `dayAndDate` in `App.jsx` therefore build the string by hand from
`WEEKDAY_NAMES` / `MONTH_NAMES` — always day-first, and always "Sept" rather
than "Sep", which is what this office writes. They parse at NOON for the same
reason the recurrence code does: a date-only string read at midnight can land
on the previous day once an offset is applied, which would print the right
date against the wrong weekday.

## Tasks have a time RANGE

`due_time` is the START time and `end_time` is the optional end — added
after people took to writing "2–4 PM" into activity titles. Render both
through `formatTimeRange(start, end)` so every surface shows a range
identically. An end time with no start, or one that isn't strictly after
the start, is rejected server-side in `tasks.routes.js` (`validateTimeRange`),
and the PATCH path validates the range as it will BE after the patch —
changing only the start can invalidate an end time that's already stored.
Recurring occurrences inherit both times; `generateForTask` builds its head
object by hand, so any new task field has to be added there too or it
silently won't be copied onto occurrences.

## Activity-log blocks: two getters, only one has `content`

`getActivityLogById` deliberately selects everything EXCEPT `content` (it's
used for ownership checks). Anything that reads or rewrites the blocks must
use `getActivityLogWithContent` — reaching for the wrong one gives you
`content === undefined` and a confusing "that activity is no longer there"
rather than a crash. Hit during the complete/pending work.

Block status (`block.status`: "done" | "pending" | absent) is changed through
`PATCH /activity-log/:date/blocks/:index/status`, which mutates one block
server-side. Don't replace it with a client-side read-modify-write of the
whole entry — that races with a concurrent edit in another tab.

## Live data: fetch-once lists are a bug waiting to happen

`broadcastTaskChange` already fires on every task change including comments,
and the workspace socket room reaches everyone. Any list that renders
other people's contributions must SUBSCRIBE, not just fetch on mount — task
comments shipped fetch-once and produced a "member comments are invisible to
everyone else" report that looked like a permissions bug and wasn't. The
pattern to copy is in `Comments`: `socket.on("task:changed", …)` filtered by
`reason` and `taskId`, cleaned up on unmount. `ActivityComments` does the
same with `activity:comment`.

## The "stage now, upload after save" pattern

Files can't go in a JSON body. Established pattern, used in three places
(subtask creation, milestone creation, task creation): the creation form
lets the user stage files/links locally in React state (`pendingFiles`,
`pendingLinks`), the resource is created first via JSON (getting a real
id), then staged links/files upload via real follow-up API calls, matched
back by array position (order is preserved by the backend in both create
and update paths). See `PendingFilesLinks` component and `saveDraft` in
`App.jsx` for the canonical implementation — replicate this pattern, don't
invent a new one.

## Testing convention

Every change in this project has historically been verified against a real
Postgres instance and, for frontend changes, a real Playwright browser
session — not just code review. If Postgres/Playwright aren't already set
up in the environment: `apt-get install postgresql postgresql-contrib`,
`service postgresql start`, `su postgres -c "psql -c \"ALTER USER postgres
PASSWORD 'postgres';\""`. Local DB conventions: `PGSSL=false`,
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<dbname>`.

Background processes (backend/frontend dev servers) do NOT survive between
separate tool calls in some sandboxed environments — start them and run
tests in the same command/session, don't assume a `node src/index.js &`
from one step is still running in the next.

## Demo/seed accounts (backend/src/seed.js)

All seeded into workspace "Product Studio":
- `daniel@flowhub.dev` — Admin, password `admin123` (deliberately different
  from everyone else)
- `priya@flowhub.dev` — Lead, password `password123`
- `leo@flowhub.dev`, `sena@flowhub.dev`, `astrid@flowhub.dev`,
  `ravi@flowhub.dev` — Members, password `password123`

`npm run seed` is idempotent — checks if `daniel@flowhub.dev` already
exists and skips entirely if so, rather than duplicating.

## lucide-react icon imports — watch for JS built-in collisions

Several icon names in `lucide-react` collide with JavaScript built-ins:
`Image`, `Table`, and `Map` are icons AND native JS constructors. This
codebase already aliases the first two (`Image as ImageIcon`, `Table as
TableIcon`) — follow that same pattern for any new icon import before using
it, don't just `import { Map }` directly. A real instance of this shipped
broken and crashed the entire app on load (`Map is not a constructor`,
because it shadowed `new Map()` used elsewhere for actual caching) — caught
only by an actual browser test, not by the build or a syntax check, since
`Map is not a constructor` is a runtime error that only surfaces when that
code path actually executes.

## Branding

App is branded as PMDAMC using DAMC's real logo (a three-circle mark with
green leaf accents — the actual file is `frontend/public/logo.png`, sourced
from the department's real logo, background removed). The color palette
(`frontend/src/styles.css`) was deliberately rebuilt around the logo's
green (`#2FA34F` dark theme / `#1F7D3B` light theme) — priority/status
colors (red/amber/blue/teal) were kept deliberately distinct from the brand
accent for readability, don't collapse them into the same green.

**Three themes, four choices.** `data-theme` is `dark`, `light` or `warm`;
the user's stored *preference* adds `system`, which resolves via
`prefers-color-scheme` and re-resolves when the OS flips. Preference and
painted theme are separate values in `ThemeContext` on purpose — collapsing
them loses the user's choice the moment the OS changes. Warm is a light
scheme on a cream ground: its status colours are shifted warm (deeper red,
ochre amber) rather than copied from the light theme, which glares against
cream. Any new colour needs a value in all three blocks, or that theme
silently falls back to whatever was last set.

## Personal appearance: theme + accent, per person

`users.theme_preference` and `users.accent_color` (both nullable, both
CHECK-constrained). `PATCH /users/me/appearance` saves them and emits
`appearance:changed` to that person's `user:<id>` socket room only.

How the pieces fit — don't collapse any of them:
- `frontend/src/appearance.js` — pure: presets, contrast maths, the device
  cache. `accentVarsFor(accent, theme)` re-tones ANY colour per theme to 4.5:1
  against the panel (lighter on dark, deeper on light/warm) and picks a
  readable `--accent-ink`. `"damc"` returns null on purpose: the stylesheet's
  hand-tuned greens stand.
- `ThemeContext` — the live value and the painting. Keeps `preference`
  (picked, incl. "system"), `theme` (painted) and `ownerId` (whose choice this
  is) separate.
- `AppearanceSync` — inside AuthProvider; reconciles device vs account on
  sign-in (unsynced local change > account > adopt device if it's theirs or
  nobody's > defaults), debounces saves, listens for other devices. Ignores
  its own socket echo via `X-Client-Id` / `CLIENT_ID`.
- `index.html` inline script — paints from the cache before React loads. It
  does no colour maths: it only applies values `appearance.js` already
  computed and cached for all three themes. Keep it that way, or the two will
  drift.

Rules:
- **The accent is for controls, not meaning.** `--success` (completed) and
  `--clock` (times) are separate tokens that stay brand green. If you add
  something that SAYS done/late/urgent, don't colour it with `--accent`.
- **Anything drawn ON an accent fill uses `--accent-ink`**, never a literal —
  a hard-coded dark tick disappears on a dark accent.
- **Sign-out must not clear `pmdamc.appearance`.** The device keeps its last
  user's look and the sign-in screen must not flash back to defaults. Another
  person signing in gets THEIR look or the defaults — never the previous
  person's (case 4 in AppearanceSync).
- Appearance is private: it is on `publicUser` (what a person sees about
  themselves) and must never be added to `getWorkspaceMembers`.
- `publicUser` lives in `backend/src/utils/publicUser.js`. There used to be
  two copies and they drifted (one reported no profile photo). Keep one.

### Background tint (`users.accent_tint`: off | subtle | rich | NULL)

- NULL means "never chosen". `effectiveTint()` resolves it: off for damc,
  subtle for any other colour. Keep the null and don't store the resolved
  value, so picking a new colour later still gets the default for that colour.
- `tintedNeutrals()` re-hues the neutral tokens toward the accent while
  holding each one's WCAG luminance (binary search in `atLuminance`). That is
  why contrast survives: never tint by blending with the accent, because
  blending changes luminance.
- `WHITE_CAP` scales ALL surfaces of a theme by one factor. If you cap only
  the white panel, the page-to-card step collapses in Light.
- `THEME_NEUTRALS` in appearance.js MUST mirror the theme blocks in
  styles.css. If you change a neutral in one, change it in the other.
- Every name the engine may set is in `MANAGED_VARS`, and `applyAccentVars`
  removes any it doesn't set. The pre-paint script in `index.html` has the
  same list as an allowlist. Adding a token means adding it in both places.
- New surfaces must use `--ink`, `--panel`, `--raised` and `--line`, never a
  hex value. A literal background is the one thing the tint can't reach.

## Feature switches at the top of App.jsx

- `SUBTASKS_ENABLED = false`: hides every subtask control. Data is untouched:
  subtasks are kept on save and still appear in the Word report. Bulk-add
  sends indented lines as `description` bullets instead (the backend `/bulk`
  route accepts `description` per task).
- `FILE_UPLOADS_ENABLED = false`: the Chief wants people sharing Google Drive
  links, not uploading copies. It hides every upload button and drop zone
  (task dialog, Files page, milestones). Files that are already uploaded stay
  listed, open, and can be removed. The server's upload endpoints are left in
  place, so turning this back on is a one-line change. Don't delete the
  upload code paths.

## Assigned-by is judged against the list's OWNER (AgendaOwnerContext)

`AssignedByChip` reads `AgendaOwnerContext`, which is set by the person's own
Dashboard (the current user), each Team Members card (that member), and each
row in All Teams Collabs. If the owner is one of the task's assignees, the chip
hides only when the owner created the task. With no owner (board cards), it
hides only when every assignee is the creator. Comparing against `assigneeId`
alone was the Assignee 2 bug.

## Milestones page is workspace-wide

`GET /workspaces/:id/milestones` (`getWorkspaceMilestones`) returns every
milestone with `projectName`. `POST …/milestones` accepts an optional
`link: {label, url}`, which is validated before anything is written. `PUT`
accepts `projectId` to move a milestone. Moving requires being able to manage
the TARGET project too. Project timeline, lead and reference links were taken
off this page on purpose (see README), so don't put them back. Project
details are edited in `ProjectDetailsModal`, opened from the sidebar pencil.

## Completed Projects = `projects.completed_at`, filed by drag and drop

`ProjectsSidebarList` shows the folder under All projects. It uses HTML5
drag-and-drop:
- Dropping an active project on the folder completes it.
- Dropping a completed project on All projects, or on any active row, reopens it.
- Dropping it anywhere else reverts the optimistic order.

Firefox needs `dataTransfer.setData` in dragstart. The row button
(FolderCheck / ArchiveRestore) is the non-drag path; keep it. Who can file a
project follows `requireProjectManager`: workspace admin/lead, or that
project's lead. Native drag gestures hang in the headless test sandbox, so
tests dispatch the drag events directly (see the `htmlDrag` helper used in
this round's tests).

## Task reminders (`task_reminders`, `utils/taskReminders.js`)

- WHEN a reminder fires is never stored. `FIRE_AT` computes it from the task
  as it is now: due + due_time, or 09:00 for an untimed task, in
  `REMINDER_TZ` (default Asia/Thimphu), minus `minutes_before`. A reschedule
  therefore moves the reminders automatically. After any write that changes
  `due` or `due_time`, call `rearmReminders`:
  - a reminder that is now in the future is armed again;
  - one clearly in the past is settled without firing;
  - one just past is left for the sweep.
- `sent_at` doubles as the claim. The sweep runs every minute, claims rows
  with `UPDATE … FOR UPDATE SKIP LOCKED`, and then delivers. So two
  instances can't double-send. Rows more than 2 hours late (server was down)
  are claimed but dropped, never sent late.
- Recipients are the assignee and the second assignee. An email reminder
  falls back to in-app when no mail provider is configured
  (`sendTaskReminderEmail` returns false).
- Recurring: `generateForHead` calls `copyReminders(head → occurrence)`. The
  PUT accepts `scope: "series"`, which applies to every upcoming, unfinished
  occurrence.
- `setTaskReminders` keeps unchanged rows, along with their `sent_at`, so
  re-saving a dialog never re-sends a reminder that already went out.
- The desktop pop-up is built in `onNotification` (Workspace). It uses
  `openEditByIdRef` because the socket handler is registered once.

## Super Admin (`users.is_platform_admin`)

- `requireWorkspaceMember` gives a Super Admin a synthetic membership with
  `{ role: "admin", superAdmin: true }` in any workspace they aren't in. Only
  `role` is read from `req.membership` anywhere, so this is enough. Don't add
  them as real members: that would put them on rosters, in reports and in
  assignee lists.
- `getWorkspacesForUser(id, { includeAll })` returns every workspace for a
  Super Admin, with `superAdminAccess: true` where they aren't a member. The
  frontend's `currentUser` falls back to `role: "admin"` in that case.
- `routes/superadmin.routes.js` holds the overview, create account, reset
  password, grant/revoke and set membership. Every action is logged as
  `[super-admin] <email>: …`. The last Super Admin can't be removed. A Super
  Admin set through `PLATFORM_ADMIN_EMAILS` can't be removed here, because the
  env var would re-grant it on their next sign-in.
- First account: `npm run create-superadmin` (`src/createSuperAdmin.js`).
  It is idempotent.
- **Sessions:** `users.password_changed_at` is set by `updateUserPassword`.
  `auth.isStale` refuses any token issued before it, on both REST and the
  socket handshake. Tokens carry `iatMs`, because a JWT's own `iat` is whole
  seconds and a same-second session used to survive a reset. Always mint
  tokens with `signToken` from auth.js. A password change returns a fresh
  token. The socket's `auth` is a function so reconnects pick that token up.
- `socket.on("workspace:join")` checks membership (or Super Admin). It used to
  join whatever room id it was sent.

## Contexts key on WHO is signed in, not on the user object

`WorkspaceProvider` reloads on `user?.id`, not `user`. The user object is
replaced whenever anything about the person changes (name, photo,
appearance), and depending on it reloaded every workspace behind a spinner —
unmounting whatever was open. Any new effect that means "a different person
signed in" must depend on the id.

## Profile photos live in the DATABASE — don't move them back to disk

`users.avatar_data` (BYTEA) + `users.avatar_mime` hold the image. The bytes
are read straight off the multer upload, stored in the row, and the temporary
file is deleted; `avatar_path` is cleared at the same time so a stale file can
never be served in preference. `USER_COLUMNS` deliberately does NOT select
`avatar_data` — that projection loads on every authenticated request — and
exposes `hasAvatar` instead; `getUserAvatar` is the only thing that reads the
bytes. A photo uploaded under the old file scheme is migrated into the row the
first time anyone views it, so the fallback path is self-clearing.

This was a real report ("my picture disappears when I reopen the session")
and it is the same ephemeral-disk cause as the section below. Photos are small
and bounded (one per person, 4MB cap), so the database is the right home for
them. Task and project FILES are not bounded that way and still live on disk —
see below.

## An activity can have TWO assignees

`tasks.assignee_2_id` — one nullable column, not a join table. Every screen,
filter, report and permission check in this codebase reads `assignee_id`, and
a many-to-many would have meant rewriting all of them at once for a
requirement that was specifically "a second slot". If a THIRD is ever needed,
that is the moment to introduce the join table — not before.

The rules that make it real rather than decorative:
- `isOwnerOf` (backend) and `isAssignedTo` (frontend) are the single
  definitions of "this is mine". Every dashboard filter, the Team column, the
  report's `isTheirs`, and both permission checks go through them.
- The two slots must hold DIFFERENT people — the same name in both would
  double-count the activity everywhere. Rejected 400 on create and on patch.
- `generateForTask` builds its head object by hand, so `assignee2Id` had to be
  added there too or repeating occurrences would silently lose the second
  person. Any future task column has the same trap.
- A shared activity appears in BOTH people's reports: `reportData.js` filters
  on `assignee_id OR assignee_2_id`. The team total is therefore not the sum
  of the per-person columns, which is correct and far less misleading than
  half of someone's work missing from their own record.

## Uploads live on ephemeral disk — this is a known, unfixed root cause

multer writes to `backend/uploads/` on the backend's own filesystem. On
Render that disk is **ephemeral**: every redeploy or restart wipes it while
the `documents` rows survive, so the UI lists files that no longer exist.
"Files won't open" has been reported from production and this is why — it is
not a permissions or routing bug. The real fix is a Render persistent disk or
object storage (S3 / Supabase Storage); until then the API reports `missing`
per document (computed from `storagePath` + `fs.existsSync`, which is why
`DOCUMENT_SELECT` must keep exposing `storagePath`) and the UI shows an amber
warning rather than a dead link.

**Never write an empty `catch {}` around a user-initiated action.** Both the
Files page and the board files panel swallowed the failure, so clicking a
broken file did nothing whatsoever — no error, no console line — which is why
this looked unreproducible for so long. Surface it.

## The Collaboration Log module was removed

The standalone Log module is gone: it duplicated what the dashboard already
showed and confused people about where an activity "lived". The *data* is
unchanged — `activity_log` rows, the blocks, their status and comments are
all still there and still served by `activity.routes.js`; only the nav entry
and its page were removed. What used to be "Quick add" is now the single
entry point and is labelled **Initiate Collaboration**. Don't reintroduce a
Log page without being asked.

## Agenda rows group under one date heading

`GroupedAgenda` in `App.jsx` collapses consecutive rows sharing a `dateLabel`
under a single heading, the way comment threads read. `AgendaRow` takes a
`grouped` prop for this: inside a group the heading already carries the date,
so an untimed row renders nothing in the time column instead of a column of
"Anytime". Any new agenda-style list should render through `GroupedAgenda`
rather than mapping `AgendaRow` itself — Upcoming and Pending Collabs each
had their own copy of the row loop and each had to be converted.

## The Word report is assembled server-side, from its own queries

`backend/src/reports/` holds it: `reportData.js` gathers, `teamReportDocx.js`
renders, `routes/reports.routes.js` serves
`GET /workspaces/:id/reports/team.docx?userId&projectId&from&to`.

- It does NOT reuse the normal getters. Those are shaped for the UI — counts
  instead of contents, only the LAST comment, no file list — and a report that
  silently drops a comment or a file is worse than no report. Each entity is
  fetched whole, in a fixed number of queries, then stitched in JS. If you add
  a field to a task, add it to the report too or it won't be in the record.
- Undated tasks are deliberately KEPT when a from/to window is given: "what
  has this person worked on" includes work nobody put a date against.
- A plain member may only request their own report; the same boundary the rest
  of the app enforces, applied here because a report is a very efficient way
  to read everyone else's work in one go.
- The logo is `backend/assets/logo.png`, a copy. The backend deploys on its
  own and must not depend on the static site's files being anywhere near it.
- `docx` is a backend dependency now — a deploy needs `npm install`.
- `cors({ exposedHeaders: ["Content-Disposition"] })` in `index.js` is what
  lets the browser read the filename the server chose. Without it the report
  downloads as a generic name; it is not decoration.
- Dates in the document are dd/mm/yyyy, same rule as the UI.

### The project report shares the team report's renderers

`GET /workspaces/:id/reports/project.docx?projectId&from&to` serves it. It is
built by `reports/projectReportDocx.js` from the same `gatherReportData`
output, which now also carries `milestones`. It imports the formatting,
lateness maths and `activityBlock` from `teamReportDocx.js` (`shared`), so the
two documents print and count an activity identically. Add any new helper
there, not as a copy.

- `buildEntries` merges three things into one list, oldest first, with undated
  items last: the project's tasks, day-book blocks whose `projectId` is this
  project, and milestones. A block without that `projectId` is NOT included.
  Someone's unrelated day-book lines must not leak into a project record.
- Access: workspace admin/lead, or `projects.lead_id`. The frontend only lists
  those projects for that person.

### Report times are office time (`REPORT_TZ`, default Asia/Thimphu)

`fmtTimestamp`, `todayIso` and the completion date in `completionTiming` go
through `localDateOf` / `zoneParts`. Never use `getHours()` or
`toISOString().slice(0,10)` in a report. The server runs on UTC, so those print
08:00 as 02:00 and move early-morning completions to the previous day.

### Lateness is computed, never stored

`overdueDays`, `completionTiming` and `memberStats` in `teamReportDocx.js` are
the single source for every "how late" figure in the document — the registers,
the scorecards, the summary columns and the per-activity strips all read from
them. Day counts use `Date.UTC(y, m-1, d, 12)` on 'YYYY-MM-DD' strings, the
same UTC-noon rule as the recurrence code, so a server timezone can't shift a
count by a day. Don't add a second way of working out whether something is
late.

## Project creation is open to members

`POST /workspaces/:id/projects` accepts `member` as well as admin/lead —
anyone can start a piece of work. Reorder, rename, delete and the project
document routes stay manager-only. The sidebar's New project control sits
ABOVE the list and renders whether or not the list is expanded.

## The Files page shows task attachments too, and subscribes

`GET /projects/:id/documents` returns `documents`, `taskFiles` and `taskLinks`
— files and links attached to the project's TASKS ride along, because to the
person who uploaded one it is simply "a file in this project", and not finding
it under Files was a real report. `broadcastDocumentsChanged` fires from
`broadcastTaskChange` whenever the reason is "attachment" or "link", raised in
that one place rather than at each of the eight call sites so a future one
can't forget it. The Files page listens for `documents:changed` and refreshes
quietly (no loading state) — another instance of the fetch-once rule above.

## Deploy checklist reminder

`CORS_ORIGIN` and `APP_URL` on the backend must exactly match the real
frontend URL (no trailing slash, correct protocol) — this has been the
single most common deploy issue across every session. If someone reports a
CORS error after deploying, check these two env vars first before anything
else.

## README.md

Has a running "What's new in this round" changelog at the top of each
major change, moved to "Previously shipped" over time. Keep adding to it in
the same style when you ship something — it's the project's own memory
across sessions, in addition to this file.
