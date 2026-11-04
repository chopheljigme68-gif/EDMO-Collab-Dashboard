# EDMO Collab Dashboard — deployment checklist

A separate system from PMDAMC: give it its own database, its own `JWT_SECRET`
and its own Render/Vercel services (see README → Setting it up).

Everything here has been verified against a real Postgres and a real browser.
Work through it in order; each step says how to prove it worked.

## 1. Database

```bash
cd backend
npm install          # docx was added for the Word report
npm run migrate      # idempotent — safe to run against any previous version
```

`npm run migrate` adds, among earlier changes:

- `users.avatar_data`, `users.avatar_mime` — profile photos now live in the
  database
- `tasks.assignee_2_id` — the second person on an activity
- `users.theme_preference`, `users.accent_color`, `users.accent_tint` —
  each person's own appearance (theme, colour, and background tint)
- `task_reminders` — Google-Calendar-style reminders on tasks
- `users.password_changed_at` — a password change signs out old sessions

Create the Super Admin once, after migrating:

```
npm run create-superadmin -- --email you@example.com --name "Your Name"
```

On Render, run it from the backend service's **Shell** tab. It uses the
same `DATABASE_URL` as the service. Note the password it prints: it is shown
only once.
- `tasks.meeting_notes`, `tasks.end_time`, `tasks.recurrence_exdates`

Prove it:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tasks'
  AND column_name IN ('assignee_2_id','meeting_notes','end_time');
```

## 2. Backend environment (Render → the service → Environment)

| Variable | Value | Why it matters |
|---|---|---|
| `DATABASE_URL` | the Supabase connection string | |
| `PGSSL` | `true` on Supabase | |
| `JWT_SECRET` | a long random string, **not** the dev default | every session token is signed with it |
| `CORS_ORIGIN` | the exact frontend URL, no trailing slash | the single most common deploy failure |
| `APP_URL` | the same frontend URL | every invite and password-reset link is built from it |

Prove it: open `https://<backend>/api/health`. You want

```json
{"ok":true,"build":"…","reports":true}
```

`reports: true` confirms the running process has the report code — not an
older one still holding the port.

## 3. Uploaded files — read this before going live

Profile photos are safe: they are stored in the database and survive any
restart.

**Task and project files are not.** They are written to the backend's own
disk, which Render wipes on every deploy and restart. The database rows
survive, the bytes do not, so files uploaded before a deploy will show an
amber "file missing from storage" warning afterwards. The app tells the truth
about it rather than failing silently, but the data is gone.

Fix before people rely on it, either:

- **Render persistent disk** — add a disk to the service, mount it at
  `/var/data`, and set `UPLOAD_ROOT=/var/data/uploads`. Cheapest change, keeps
  the current code.
- **Object storage** (S3 / Supabase Storage) — the right answer if the app
  ever runs on more than one instance, since a disk is attached to one.

Until one of those is done, tell people to keep anything important in Google
Drive and paste the link instead — the Files page accepts links for exactly
this reason.

## 4. Frontend

Set `VITE_API_URL` to the backend URL, then `npm run build` and deploy
`dist/`. A stale `VITE_API_URL` is baked into the bundle at build time, so it
cannot be fixed by an environment change afterwards — rebuild.

## 5. First-run checks, in the live app

1. Sign in as the admin. The dashboard loads with no console errors.
2. Upload a profile photo, sign out, sign back in — the photo is still there.
3. Create an activity with a second assignee. Both people see it on their own
   dashboard and can edit it.
4. Team → Download report. A .docx arrives with the DAMC letterhead, the
   overdue register and each person's completed work.
5. As a plain member: New project appears; Edit and Delete work on their own
   activity; opening someone else's shows "View only".
6. Upload a file against an activity, then open Files — it appears there
   under "From activities" without a reload.
7. Open Appearance (top right), pick Light and a colour, sign out — the sign-in
   page keeps it. Sign in on a second browser — it's there too. Sign in as
   someone else on the first browser — they do NOT get your colours.
8. In the same panel set Background tint to Rich — the page, cards and
   sidebar take the colour, not only the buttons. Reload: no flash of the
   old background.
9. Milestones: add one with the form (date, title, project, details, Drive
   link). It appears under Upcoming with its project. Sign in as a member:
   the list is visible but can't be changed.
10. Drag a project onto "Completed Projects" in the sidebar. It leaves the
    list, and Undo brings it back.
11. Initiate Collaboration: there's no "Add file", and the section reads
    "File Links".
12. Team → Project report: pick a project and download. It opens in Word
    with a timeline in date order, and times are in Bhutan time.
13. Give a colleague a task. They can edit and complete it but see no
    Delete button. You can delete it.
14. Open a task with a time later today and add a reminder 5 minutes before.
    At that time the assignee gets a bell notification and a desktop pop-up.
15. Sign in as the Super Admin. The crown icon "Super Admin" page lists
    every workspace and account. Create an account, then sign in with the
    password it shows.

## 6. Accounts

`npm run seed` creates demo accounts (`daniel@flowhub.dev` and colleagues).
**Do not run it against production.** Real users join by invitation from the
Team page; the first account created becomes the workspace admin.
