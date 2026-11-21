# Orbit

Orbit is a project organizer and task tracker with a dashboard for project progress, upcoming work, and weekly momentum. The local Vite preview stores data in the current browser. The deployed Vercel app uses a Neon database for shared workspaces, invite codes, and device access.

## Backups

Orbit saves its current data in the browser that you use. Use **Download backup** in the app to save a JSON copy of projects, tasks, notes, sprints, meetings, and calendar events. Keep that file in a backed-up location such as your OneDrive folder. To recover data, open Orbit in the browser and choose **Restore backup**; restoring replaces the data currently in that browser.

Browser storage is scoped to the browser profile and site address. Keep using the same browser and address to see the same data, or restore a downloaded backup if either changes.

## Get started

Install Node.js, then run the local preview:

```sh
npm install
npm run dev
```

Create a production build with `npm run build`. The local preview is for interface testing only; its browser-local invite codes do not connect separate devices.

## Shared workspace deployment

To let another device join and share updates:

1. Create a Neon Postgres database and apply [`db/migrations/0001_workspace.sql`](./db/migrations/0001_workspace.sql) in its SQL editor.
2. Add the Neon connection string as the `DATABASE_URL` environment variable in the Vercel project. Keep it server-only; do not use a `VITE_` prefix or commit its value.
3. Import this project into Vercel and deploy it. Vercel hosts the frontend and the same-origin workspace API routes.
4. Open the deployed HTTPS URL, create a workspace, then create and share an invite code from the workspace menu.

No Vercel or Neon credentials should be shared in chat. Google Calendar sync and browser push require additional configuration and are independent of basic shared workspace access.

## Calendar

The calendar includes month, week, and agenda views for dated tasks, project meetings, and events. Use **Export for Google** to download an `.ics` snapshot and import it into Google Calendar. This is a manual import, not automatic two-way sync; live Google sync requires a Google OAuth client ID and Calendar API setup.
