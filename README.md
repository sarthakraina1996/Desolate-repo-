# BrainADZ Projects

Project management for the three BrainADZ verticals: **Live**, **Marketing** and **Exhibits**. It uses the same look as the BrainADZ HRMS.

The main rule: **people only see the verticals they have been given.** An Exhibits person sees Exhibits projects, a Marketing person sees Marketing projects, and a Live person sees Live projects. Admins see everything. The server enforces this on every request, so a project from another vertical behaves as if it does not exist, whether you look for it in a list, a search, the calendar, the asset library, or a direct link.

## What it does

| Area | What you get |
| --- | --- |
| **Menu** | Colourful icons for every page. On a computer the menu collapses to a slim rail of icons with the BrainADZ "Br" monogram (button on the menu's edge, the monogram itself, or the `[` key); hovering an icon shows its name and counts sit on the icon. The choice is remembered. Phones and tablets keep the slide-out menu. |
| **Floating menu** | For the most room, choose **Floating menu** at the bottom of the side menu: the menu steps aside and a navy Br button floats on screen, with a red count when something new is waiting. Drag it anywhere with mouse, touch or pen; it snaps to the nearer side, never leaves the screen and stays where you put it. A tap opens either the floating menu (icons only or with names, opening on whichever side has room) or **Quick Access**, a card of page tiles with a search that you can drag by its header. `[` opens and closes it, Escape or a click elsewhere closes it, and **Show the side menu** brings the normal menu back. |
| **Dashboard** | Active projects, tasks due this week, overdue tasks, projects that need attention, upcoming event, show and launch dates, and recent activity. |
| **Projects** | List, board and timeline views. The board works like Trello: cards with cover images, labels and badges, drag between and within columns, **Add a card** at the bottom of each column, and a list menu to sort or collapse. Filter by status, health, owner or client. Export to CSV. |
| **Board columns** | Planning → Active → On hold → **Delivered** for Live and Marketing. Exhibits ends at **Ready for Event / Exhibition** instead, and only people with Exhibits access see that column. An admin can give any vertical its own last column under Settings → Verticals. |
| **Project page** | Stage tracker, owner, dates, budget in ₹, location, progress, milestones, team, brief, and tabs for tasks, files and discussion. |
| **Tasks** | Assignee, due date, priority, stage, status (To do, In progress, In review, Blocked, Done), checklist, files, comments with @mentions, and a change history. Shown grouped by stage, or as a Trello-style board. |
| **Comments** | The author can delete a comment for 15 seconds after posting (with a countdown). After that it can only be removed if the author asks and a head of the vertical (a manager or an admin) approves; then the author gets the Delete option back. Heads cannot approve their own requests, but they can remove other people's comments directly; the author is told and the history records it. |
| **Team Groups** | Every project has a group chat for the people working on it, like a Slack channel. People join automatically: the owner, the project team, and anyone who gets a task in the project. Post a **message**, a progress **update**, or your **status** (On track, Need help, Blocked, Done for today), and **share files**: stall designs, renders, drawings, photos, PDFs or anything else, up to 10 per message, with the paperclip, by dropping them on the chat, or by pasting a screenshot. Images show as previews and open full size; other files download in one click. Shared files are saved to the project's Files & assets as well (marked "Group chat"), and the group's **Files** tab lists everything shared in it; the People panel shows everyone's latest status, and a Blocked or Need help post also notifies the project owner. @mentions with name suggestions, unread counts in red, and a "New" line where you left off. Heads of the vertical can look in on every group they oversee. When the project is delivered or cancelled, the group closes on its own: it drops off everyone's list and its messages stay with the project, read-only (open **Group history** on the project). Reopening the project reopens the group. Messages follow the same delete rule as comments; deleting a message also removes the files shared in it, unless someone has marked a file as a final asset. Web links in messages and comments are clickable. |
| **New-item alerts** | Counts turn red when someone else has added something since you last looked: the Tasks, Files & assets and Discussion tabs on a project, My Work (newly assigned tasks), Projects and Team Groups in the sidebar, each group, board columns and file categories. New items carry a red NEW tag. Once you open the tab, the count turns grey. Each person has their own read state. |
| **Files & assets** | Drag-and-drop uploads, links to Drive, Dropbox or Figma, automatic categories (Brief, Design, Contract & PO, Quotes & Invoices, Production, Photos & Videos, Final deliverables, Reports), and a star for final assets. |
| **My Work** | Your tasks grouped into Overdue, Today, This week, Next week and Later. |
| **Calendar** | Month view of event days, show openings, launches, milestones and task deadlines. |
| **Asset Library** | Every file from current and past projects, searchable by client, year, type and category. |
| **Past Projects** | Completed and cancelled projects by year, with a client view. **Run again** copies a past project's plan, team and milestones to new dates, which suits repeat clients and annual shows. |
| **Templates** | Ready-made plans per vertical, such as Exhibition stall, Corporate event or Integrated campaign. Task dates count back from the event, show or launch date. Any finished project can be saved as a template. |
| **Team & Access** | One grid to set each person's access per vertical: Viewer, Member or Manager. |
| **Notifications** | Sent when someone assigns you work, mentions you (in a comment or a group), comments on your task, adds you to a project, or asks for help in a group you own. |

### Access levels (set per vertical)

| Level | Can do |
| --- | --- |
| **Viewer** | See projects, tasks and files. Cannot change anything. Can read the group of a project they are on, but not post. |
| **Member** | Work on projects: tasks, files, milestones, comments and group chat. Can edit projects they own. |
| **Manager** | Create, edit, close, re-open and copy projects. Manage templates. Look in on every group in the vertical. Approve or decline requests to delete old comments and messages (the "head" of the vertical). |
| **Admin** (company-wide) | Everything in every vertical, plus people, access, verticals and settings. |

### Works for other industries

Verticals are not hard-coded. An admin can add a new one under **Settings → Verticals**, for example *Retail* with the code `RTL` and a key date called *Store opening*, then add templates and give people access. The key date label changes per vertical: *Event date* for Live, *Show opens* for Exhibits, *Launch date* for Marketing.

## Run it

You need Node.js 22.13 or newer.

```bash
npm install
npm run build          # build the web app
npm start              # http://localhost:3000
```

On first start the server creates an admin account and prints the email and a temporary password in the terminal. To choose them yourself:

```bash
ADMIN_EMAIL=you@brainadz.com ADMIN_PASSWORD='a-strong-password' npm start
```

### Try it with sample data

```bash
npm run seed:demo
npm start
```

This adds a fictional team and about twenty projects. Every sample person signs in with the password `demo1234`, for example:

| Email | Sees |
| --- | --- |
| rajiv.malhotra@brainadz.com | Admin, all verticals |
| suresh.iyer@brainadz.com | Exhibits manager |
| rohan.das@brainadz.com | Exhibits member |
| kavita.rao@brainadz.com | Marketing manager |
| arvind.menon@brainadz.com | Live manager |
| siddharth.menon@brainadz.com | Live and Marketing member |
| vikram.patel@brainadz.com | Viewer for Live and Exhibits |

### Development

```bash
npm run dev            # API on :3000 and the web app with hot reload on :5173
npm test               # access-control and server tests
```

## Host it from this repository

### Option 1: GitHub Pages (free, demo only)

`docs/index.html` is the one-file browser demo. GitHub can serve it straight from this repository:

1. On GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick the branch that holds this code and the **/docs** folder, then press **Save**.
4. After a minute the site is live at `https://<github-user>.github.io/<repo-name>/`.

Every visitor gets their own copy of the sample data, kept in their browser. Use it for showing the app, not for real work. After changing the code, run `npm run build:pages` and commit `docs/` to update it.

### Option 2: Render (the real app for your team)

`render.yaml` describes the whole setup: a Node web service plus a 5 GB disk for the database and uploaded files.

1. Sign in at [render.com](https://render.com) with your GitHub account.
2. Choose **New → Blueprint**, pick this repository and the branch that holds this code.
3. Fill in `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first admin, then **Apply**.
4. When the deploy finishes, open the `onrender.com` address Render shows, sign in as that admin, and add your team under **Team & Access**.

The disk needs a paid instance (Render's Starter plan). Everything people add lives on the disk at `/var/data`, which Render keeps across deploys and restarts. A custom domain such as `projects.brainadz.com` can be added in the service's **Settings → Custom Domains**.

### Other hosts

Any host that runs Node.js 22 or Docker works. Build with `npm ci --include=dev && npm run build`, start with `npm start`, and point `DATA_DIR` at storage that survives restarts. With Docker:

```bash
docker build -t brainadz-projects .
docker run -p 3000:3000 -v brainadz-data:/data \
  -e ADMIN_EMAIL=you@brainadz.com -e ADMIN_PASSWORD='a-strong-password' \
  -e SECURE_COOKIES=1 brainadz-projects
```

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Database and uploaded files. Back up this folder. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | generated | First admin account (first start only) |
| `SECURE_COOKIES` | off | Set to `1` behind HTTPS |
| `MAX_UPLOAD_MB` | `200` | Largest file someone can upload |
| `TIMEZONE` | `Asia/Kolkata` | Decides what "today" and "overdue" mean |

## Browser demo

`npm run build:demo` produces `dist-demo/brainadz-projects.html`, a single file that runs the same API against an in-browser copy of SQLite with the sample data. It has a person switcher so you can see how access changes between verticals. Data in the demo stays in that browser, so use the server version for real work.

## How the code is organised

```
core/      the API, access rules, schema, templates and demo data (shared by server and demo)
server/    Express server: sign-in, sessions, uploads and downloads, static files
web/src/   React app (pages/, shared UI, theme.css copied from the HRMS)
tests/     node:test suites for vertical isolation, comments, boards, team groups and the HTTP server
```

Security notes: passwords are hashed with scrypt; sessions are http-only cookies; every write needs a custom header so other sites cannot submit forms on your behalf; repeated failed sign-ins are slowed down; and uploaded files are served as downloads with a locked-down content policy. `npm audit` reports one moderate advisory in the Vite development server. It does not affect the production build or the server.
