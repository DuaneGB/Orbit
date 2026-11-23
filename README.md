# Orbit

Orbit is a shared project workspace for a small team. Every device that joins sees the same projects, tasks, notes, sprints, meetings and calendar. Changes reach other devices within a few seconds. A **Hosted apps** view lists every Vercel project with its live link and deploy status.

- **Access without accounts.** Each device gets its own revocable key from a one-time invite code. Owners can see, promote and revoke devices.
- **Sync.** Devices save changes in batches and check for updates every 4 seconds while visible. A download happens only when the workspace revision has changed.
- **Hosted apps.** Orbit reads your Vercel projects server-side using `VERCEL_TOKEN`. You can link apps to Orbit projects, and they then appear in that project's space.

See [docs/AUDIT.md](docs/AUDIT.md) for the platform audit, the business rules, and the roadmap.

## Architecture

| Part | Where | Notes |
| --- | --- | --- |
| Web app | `src/` (React + Vite) | Installable PWA; push notifications via `public/sw.js` |
| API | `api/` (one Vercel Function, Node) | `vercel.json` rewrites `/api/*` to `api/router.ts`, which dispatches to `api/_routes/*` (keeps the deployment under Hobby's 12-function limit). `api/_lib` holds shared server code. Relative imports in `api/` need a `.js` extension. |
| Database | Neon Postgres, schema in `api/_lib/schema.ts` | Browser never talks to the database. The API connects with `DATABASE_URL` and creates or upgrades the tables on first use. |

API routes: `/api/workspace/{me,create,join,invites,devices,forget-device,data,sync,push,activity}`, `/api/vercel/projects`, `/api/google/{auth,callback,status,sync,disconnect}`.

## Deploy

1. **Put the code under version control.** Create a private GitHub repo, then import it in Vercel. Every push then deploys.
2. **Connect a Neon database** in Vercel → Storage. This sets `DATABASE_URL`. There's no SQL to run: the API creates its tables the first time it's used.
3. **Set the other environment variables** in Vercel → Settings → Environment Variables. [.env.example](.env.example) lists them all. Set `ORBIT_SETUP_KEY` (otherwise anyone with the URL can create a workspace) and `VERCEL_TOKEN`.
4. **Deploy.** Open the site, create the workspace (enter the setup key), then use **Workspace → Invite a device** for each phone, laptop or teammate.

## Develop

```sh
npm install
npm run dev:full   # vercel dev: app + API, reads .env.local
npm run dev        # Vite only: UI work, API calls will fail
npm test           # logic tests (sync merge, validation, dates, progress)
npm run build      # typechecks app and API, then builds
```

## Backups

**Workspace → Backups → Download backup** saves the whole workspace as JSON. **Restore backup** replaces the shared data **for every device**, so download a fresh backup before restoring an old one.

## Calendar

The calendar has month, week and agenda views covering dated tasks, project meetings, sprint dates and events. **Export for Google** downloads an `.ics` snapshot. For live two-way sync, set the Google variables in `.env.example`; an owner can then connect a calendar under **Workspace → Google Calendar**. Only events from 30 days back to a year ahead sync.
