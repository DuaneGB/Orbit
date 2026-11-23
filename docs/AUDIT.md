# Orbit platform audit

**Date:** 23 Nov 2026 · **Scope:** all source in `src/`, `api/`, `supabase/`, `public/`, build config · **Goal:** a synced workspace that many remote devices use at the same time, and that hosts every Vercel project with its links.

## 1. Summary

At the start of this audit Orbit **could not run as a shared platform**. The interface was polished, but:

- the nine `/api/workspace/*` endpoints the app depends on did not exist, so every device stopped at the access screen;
- the database, the Google Calendar API and the web app each assumed a **different login model**, so none of them could talk to the others;
- `npm run build` failed with 9 type errors.

All three are now fixed. The platform has a working device-access backend, revision-based sync, a Hosted apps view backed by the Vercel API, an activity feed, and enforced business rules (section 3). The production build passes, and 9 logic tests cover sync merging, validation, dates and progress.

**Not verified yet:** none of this has run against a real Supabase database or a Vercel deployment. Both need credentials this audit didn't have. Section 5 is the go-live checklist; plan an hour to complete and smoke-test it.

**Biggest remaining risk:** the source exists only in a OneDrive folder, with no git history. One bad sync or overwrite loses work with no way back. Fix this first (C5).

## 2. Findings

Severity: **Critical**, a launch blocker or data loss. **High**, a serious defect or risk. **Medium**, wrong behaviour or a missing core feature. **Low**, polish or a future risk.

### Critical

| # | Finding | Impact | Status |
|---|---|---|---|
| C1 | The client calls 9 `/api/workspace/*` endpoints (`me`, `create`, `join`, `data`, `sync`, `devices`, `invites`, `push`, `forget-device`), but none existed. | No device could create, join or sync a workspace. The product was non-functional. | **Fixed.** All endpoints built, plus `activity`. |
| C2 | Three incompatible auth models: the client uses invite codes and device keys; the SQL requires Supabase Auth users with MFA (`aal2`); the Google endpoints require a Supabase bearer token that no client sends. | Nothing could authenticate end to end. | **Fixed.** One device-key model throughout (migration `20261123…_device_access.sql`). Google endpoints moved onto it. |
| C3 | `npm run build` failed with 9 TypeScript errors, so Vercel couldn't deploy. | No deploy possible. | **Fixed.** `api/` is now typechecked too (it wasn't before). |
| C4 | On first load, local browser data was merged against an empty baseline, so local data always won. A new device joining uploaded its demo projects ("Brand refresh", "Spring campaign"…) into the shared workspace. | Every new device polluted shared data. | **Fixed.** First load takes the server as the source of truth; local data is offered for import only when *creating* a workspace. |
| C5 | No version control. The code lives only in OneDrive; `dist/` and `node_modules/` sit in the synced folder. | One overwrite or sync conflict loses work permanently. Vercel can't auto-deploy from git. | **Open.** Create a private GitHub repo and connect it to Vercel. |

### High

| # | Finding | Status |
|---|---|---|
| H1 | API handlers used `export default function (request: Request)`, which Vercel's Node runtime docs don't list as a supported signature. They would likely have received a Node request object and crashed on `request.headers.get`. | **Fixed.** Uses the documented named exports (`export const GET/POST…`). |
| H2 | **Notification storm.** A database webhook sent one push per changed row: restoring a 200-item backup sent 200 notifications to every device, each saying only "A teammate updated the shared workspace". | **Fixed.** At most one push per workspace every 2 minutes, with a summary ("Laptop updated Orbit: Changed 3 tasks and 1 note"). |
| H3 | Every device downloaded the entire workspace every 2.5 s, even in background tabs. Cost and latency grow with devices × data size. | **Fixed.** Devices check a revision number every 4 s, download only when it changes, and pause while hidden. |
| H4 | **Restore backup** said it replaces data "in this browser", but it actually overwrote shared data for *every* device. | **Fixed** wording and confirmation. **Open:** server-side snapshots so a bad restore can be undone. |
| H5 | Google sync imported the whole calendar history (no date window) into the shared workspace, and any member could connect a personal calendar. | **Fixed.** Window is 30 days back to 1 year ahead, and only owners can connect. **Open:** let owners pick a dedicated calendar instead of `primary`. |
| H6 | Anyone who found the URL could create unlimited workspaces. | **Fixed.** Optional `ORBIT_SETUP_KEY` gates creation. |
| H7 | The only owner could leave, orphaning the workspace, and there was no way to promote another device. | **Fixed.** Owners can promote and demote; the last owner can't leave while others remain. |
| H8 | All dependencies were pinned to `"latest"`, so every install could pull a new major version. | **Fixed.** Pinned to the tested versions. |
| H9 | Identity was hardcoded: "Good morning, Duane", "Duane User", "Free plan", every new task assigned to "DU", workspace avatar "S". Every teammate saw Duane's name. | **Fixed.** Uses the device name, role and workspace name. |
| H10 | Old RLS policies gave the browser's `authenticated` role direct table access, alongside service-role writes. | **Fixed.** Browser roles are revoked; all access goes through the API. The unused browser Supabase client was removed. |

### Medium

| # | Finding | Status |
|---|---|---|
| M1 | **Fake dashboard metrics:** "Next milestone: Nov 28 · Brand refresh · 8 days to go" was hardcoded; the weekly bar chart was a fixed array; "completed this week" counted all-time. | **Fixed.** All computed from real data (`src/insights.ts`). |
| M2 | Project progress was a manual slider, and the project's task counter was stored separately and never decreased. Both drifted from reality. | **Fixed.** Progress = % of tasks done once a project has tasks; counts are derived. |
| M3 | Due dates were free text ("Friday, Nov 28"), so there was no overdue detection, sorting, or reliable calendar placement. | **Fixed.** Date pickers; overdue, today and soon highlighting; sorted by due date. Old text dates still parse. |
| M4 | Tasks, notes, links, meetings and sprints could not be edited or deleted. | **Fixed.** Tasks can be edited and deleted (8-second undo); the others can be deleted with confirmation. |
| M5 | Tasks link to projects **by name**. Duplicate names mix tasks together; a rename is a multi-row rewrite that can race with other devices. | **Partly fixed.** Names must be unique; renames also update calendar events. **Open:** migrate tasks to `projectId`. |
| M6 | The bell, ⌘K hint, workspace switcher and profile button did nothing. | **Fixed.** The bell opens an activity feed, ⌘K/Ctrl+K focuses search, and the switcher and profile open Workspace settings. |
| M7 | Device management and backup panels sat on top of *every* page. | **Fixed.** Moved to a **Workspace** settings view. |
| M8 | There was no sync status and no warning when closing a tab with unsaved changes. | **Fixed.** Status pill in the top bar (Synced, Saving, Offline, Not synced) and a close-tab guard. |
| M9 | Dragging the progress slider sent one sync request per pixel. | **Fixed.** Saves are batched with a 400 ms debounce. |
| M10 | Sprints could end before they started, and past meetings showed as "next meeting". | **Fixed.** |
| M11 | There were no automated tests. | **Partly fixed.** `npm test` runs 9 logic tests. **Open:** API integration tests against a test database. |
| M12 | A date like "2026-02-30" was accepted and silently became 2 March. Found while writing the tests. | **Fixed.** |

### Low and open items

| # | Finding | Recommendation |
|---|---|---|
| L1 | Conflicts resolve as last-writer-wins *per item*: if two people edit the same task at once, one edit is lost silently. | Field-level merge for tasks, or a "this changed while you were editing" notice. |
| L2 | No offline mode. The PWA doesn't cache its shell, and edits need a connection. | Cache the app shell in `sw.js`; queue edits in IndexedDB. |
| L3 | **Accessibility.** Much of the interface uses 8–10px text, and grey text such as `#9b99a1` on white is about 2.8:1 contrast, below the WCAG AA minimum of 4.5:1. | Raise the base size to 13–14px and darken secondary text. This affects readability on phones most. |
| L4 | Devices aren't people. You can't assign a task to Alex, @mention, or see who's online. | See roadmap phase 2. |
| L5 | A browser can belong to only one workspace at a time. | Support multiple device keys and a real workspace switcher. |
| L6 | The join endpoint has no rate limit. Codes carry about 59 bits of randomness, so guessing is impractical, but there's no lockout. | Add per-IP throttling (Vercel Firewall rule or Upstash). |
| L7 | The Vercel API docs don't state the pagination cursor. Orbit passes `pagination.next` as `from` and stops after 1,000 projects. | Verify with a team of more than 100 projects. |
| L8 | The activity log grows forever. | Prune entries older than 90 days with a scheduled job. |

## 3. Business rules (now enforced)

**Access and roles**
1. A device joins only with a one-time invite code. Each code works once and expires after 24 hours. A workspace can have at most 10 unused codes at once.
2. Each device has its own key, stored as an HttpOnly cookie for up to 400 days. The server keeps only a SHA-256 hash of it.
3. **Owners** can invite, revoke, promote and demote devices, and connect or disconnect Google Calendar. **Members** can read and edit all shared work.
4. A workspace always has at least one owner. The last owner can't step down or leave while other devices remain.
5. Revoking a device takes effect on its next request, and removes its push subscriptions.
6. If `ORBIT_SETUP_KEY` is set, creating a new workspace requires it.
7. Every write request must carry the `x-orbit-request` header, which blocks cross-site request forgery.

**Data and sync**

8. The server is the source of truth. A device's first load always takes server data.
9. Edits are saved as batched diffs, in one database transaction per batch. Unchanged items are never rewritten, so they don't spam the activity log.
10. If two devices change the same item, the last save wins. Unsaved local edits are never overwritten by an incoming update.
11. Every item is validated on the server with the same rules as the client. Links must be http or https, an item's ID must match its payload, there are at most 2,000 changes per sync, and each item can be at most 20 KB.
12. Project names are unique within a workspace.
13. Once a project has tasks, its progress is the percentage of those tasks that are done. The manual slider applies only before the first task exists.
14. A task records `completedAt` when ticked, which drives the weekly momentum chart.
15. A sprint can't end before it starts.
16. Deleting a project deletes its tasks, notes, sprints, meetings and links for everyone. The confirmation says so.
17. Restoring a backup replaces data for every device, and the confirmation says so.

**Notifications and activity**

18. At most one push notification per workspace every 2 minutes, never sent to the device that made the change.
19. Every create, update or delete is logged with the device, item type and item name, and shown in the activity feed.

**Hosted apps**

20. Vercel credentials stay on the server. Devices see project names, links and status only.
21. Each Vercel app belongs to at most one Orbit project.
22. The production link prefers a custom domain over `*.vercel.app`. Status reflects the newest deployment.

## 4. Roadmap: making Orbit worth choosing

Ordered by value to a team running many Vercel projects.

**Phase 1 – Go live (this week)**
- Complete section 5. Get two devices editing the same project and watch updates arrive within about 4 seconds.

**Phase 2 – Real-time collaboration (high impact)**
- **People, not just devices:** a display name per person, task assignees, an "assigned to me" filter, @mentions, and comments on tasks.
- **Instant updates:** a Supabase Realtime broadcast on each sync gets updates to other devices in under a second, with polling kept as the fallback.
- **Presence:** for example "Alex is viewing Website redesign", shown as avatars on project cards.
- **Conflict notice** instead of a silent overwrite (L1).

**Phase 3 – Vercel command centre (the differentiator)**
- A **Vercel deploy webhook** feeding `/api/vercel/webhook`: instant status and a push notification when a production deploy fails.
- **Preview links on tasks:** link a task to a branch or PR, and its preview URL appears on the task.
- **Uptime checks** with a scheduled ping of each production URL, shown as a health dot.
- **Release checklist per project** (tests passed, preview reviewed, deployed, announced).
- A QR code on each app card, to open it on a phone in one scan.
- Domains and environment overview per app (read-only).

**Phase 4 – Project-management depth**
- Task status workflow (To do → In progress → Review → Done) with a **Kanban board**.
- Tasks linked to sprints, with a **burndown chart** and sprint velocity.
- **Automatic project health** (green, amber or red) from overdue tasks, a failing deploy, and slipping milestones.
- Task dependencies, recurring tasks and project templates.
- A weekly digest by email or push: what shipped, what's overdue, what's due next.

**Phase 5 – Platform**
- Viewer and guest roles (for example, a client can see one project's progress and links).
- Server-side snapshots with one-click rollback (H4).
- Multiple workspaces per device (L5), audit-log retention (L8), and an accessibility pass (L3).

## 5. Go-live checklist

1. ☐ `git init`, commit, and push to a **private** GitHub repo. Add `.env*` to `.gitignore` (done).
2. ☐ Import the repo in Vercel. The framework preset is Vite; `vercel.json` sets the build.
3. ☐ Create a Supabase project and run `supabase/migrations/20261121000000_collaboration.sql`, then `20261123000000_device_access.sql`.
4. ☐ Delete any Supabase webhook pointing at `/api/send-push` (that endpoint is gone).
5. ☐ Set environment variables from `.env.example`: at least `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORBIT_SETUP_KEY` and `VERCEL_TOKEN` (plus `VERCEL_TEAM_ID` for a team).
6. ☐ Deploy, create the workspace with the setup key, and invite a second device.
7. ☐ **Smoke test:**
   - add a task on device A and confirm it appears on device B within 5 seconds;
   - revoke B and confirm it's signed out;
   - confirm Hosted apps lists your Vercel projects with working links;
   - enable notifications on B, edit on A, and confirm one notification arrives.
8. ☐ Download a first backup.
