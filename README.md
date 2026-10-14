# Subscription Manager 🔔

A small web app to keep track of the software subscriptions you manage for yourself and your clients — **monthly, quarterly or yearly** — and automatically **email renewal reminders to you and to the client** before each renewal.

## What it does

- **Subscriptions** — software name, plan, vendor, client, billing cycle (monthly / quarterly / yearly), amount and currency. The next renewal date is worked out automatically, forever.
- **Clients** — name, company, email and phone. Each client's email is where their reminders go.
- **Automatic reminders** — once a day the app checks for upcoming renewals and emails:
  - **you**: "Renewal in 7 days: Microsoft 365 for Priya Sharma (19 Oct 2026)"
  - **the client**: a friendly "your subscription renews on 19 Oct 2026" email, signed with your business name. If they hit *Reply*, it comes to you.
- **You choose when** — per subscription, e.g. `30, 7, 1` = a month before, a week before and the day before. Defaults: monthly `7, 1`, quarterly `14, 3`, yearly `30, 7, 1`.
- **Dashboard** — what's renewing in the next 60 days, plus your total monthly and yearly cost.
- **Preview & send** — see exactly what an email will look like, and send a reminder by hand whenever you want.
- **Email log** — every email the app has sent, and any that failed (with the reason).

Each reminder is only ever sent once. If the app was switched off on the day a reminder was due, it sends it as soon as it's back on (as long as the renewal hasn't passed).

## Run it on your computer (about 5 minutes)

The app runs on your own computer and you use it in your web browser. You can try it straight away; email reminders are switched on afterwards (next section).

1. **Install Node.js** (free) from <https://nodejs.org> — choose the **LTS** version and click through the installer.
2. **Download the app**: on this GitHub page click the green **Code** button → **Download ZIP**, then unzip it (double-click the ZIP file).
3. **Start it** by double-clicking the start file in the unzipped folder:
   - **Windows:** `start-windows.bat` — if Windows shows *"Windows protected your PC"*, click **More info → Run anyway**.
   - **Mac:** `start-mac.command` — the first time, **right-click it → Open → Open** (macOS blocks downloaded files on a normal double-click).

   The first start installs a few things (about a minute). Then your browser opens **<http://localhost:3000>** with the app.
4. **Keep the black window open** while you use the app. Closing it stops the app — and the daily reminders.

Next time, just double-click the start file again. (Prefer the terminal? Run `npm install` once, then `npm start`.)

## Turn on email reminders

The app sends email through your normal email account. Until this is set up you'll see a yellow "Email sending is not set up yet" notice, and no reminders go out.

### 1. Create your settings file

In the app folder, make a copy of `.env.example` and name the copy `.env` (on Windows, if you can't see file extensions, name it `.env.` with a trailing dot — Windows removes it). Open `.env` in Notepad / TextEdit and fill it in. The important settings:

| Setting | What to put |
| --- | --- |
| `BUSINESS_NAME` | Your company name, shown on client emails |
| `OWNER_EMAIL` | Where **your** reminders should go |
| `APP_TIMEZONE` | Your time zone, e.g. `Asia/Kolkata`, `Europe/London`, `America/New_York` |
| `REMINDER_TIME` | What time of day reminders go out, e.g. `09:00` |
| `SMTP_*` and `MAIL_FROM` | Your email account details — see below |
| `APP_PASSWORD` | A password to protect the app (recommended) |

### 2. Email account details (Gmail example)

1. Turn on **2-Step Verification** for your Google account: <https://myaccount.google.com/security>
2. Create an **App Password**: <https://myaccount.google.com/apppasswords> — name it "Subscription Manager" and copy the 16-character password.
3. In `.env` set:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=the16characterpassword
   MAIL_FROM=you@gmail.com
   ```

Using another provider (Outlook, Zoho, your company mail, or a sending service like Brevo, SendGrid or Amazon SES)? Use the SMTP server, port, username and password from their help pages. For port `465` the connection is encrypted automatically.

### 3. Restart and test

Close the app's black window and double-click the start file again. Then in the app:

1. Go to **Settings**, check your details, and click **Send me a test email**.
2. Add your **Clients** (with their email addresses).
3. Add your **Subscriptions**. For *First billing date*, enter when the subscription started — or simply its next renewal date if you don't know.

## If something goes wrong

- **Browser says "This site can't be reached" / "localhost refused to connect"** — the app isn't running. Double-click the start file and keep its window open.
- **"Port 3000 is already in use"** — the app is probably already running in another window; just open <http://localhost:3000>. Otherwise add `PORT=3001` to `.env` and use <http://localhost:3001>.
- **"needs Node.js 22.13 or newer"** — install the current LTS version from <https://nodejs.org> and try again.
- **Test email fails** — the message in the app says why; usually a wrong `SMTP_PASS` (for Gmail it must be the App Password, not your normal password).

## Things to know

- **The app must be running to send reminders.** Reminders go out at `REMINDER_TIME` each day while the app is running. Run it on a computer that stays on, or host it online (below).
- **Your data** is stored in one file: `data/subscriptions.db`. Back it up by copying that file.
- **Cancelled subscriptions** stop getting reminders but keep their history. Deleting a client keeps their subscriptions (just unlinked from the client).
- **"Send reminder now"** emails don't replace the automatic ones — the scheduled reminders still go out as planned.
- **Protect the app with a password** (`APP_PASSWORD`) before putting it on the internet — it contains your clients' details and can send email in your name. When the browser asks, type any username (e.g. `admin`) and that password.

## Hosting it online

To have reminders go out without leaving your own computer on, host the app on any service that runs a Node.js app **24/7 with permanent disk storage** (for the `data/` folder) — for example a small VPS, or a platform such as Railway, Render or Fly.io with a persistent volume attached. Free tiers that "sleep" when idle or wipe the disk on restart are **not** suitable.

On the host:

- Start command: `npm start`
- Set the same settings from your `.env` as environment variables
- Set `DATABASE_PATH` to a file on the persistent disk (e.g. `/data/subscriptions.db`)
- Set `APP_URL` to the app's public address and **set `APP_PASSWORD`**

## For developers

```bash
npm run dev    # restart automatically when files change
npm test       # run the tests
```

- `src/index.js` — entry point: checks Node.js version and installation, then starts `src/server.js`
- `src/server.js` — starts the web server and the daily reminder scheduler
- `src/app.js` — web API and validation
- `src/dates.js` — renewal date maths (shared with the browser)
- `src/reminders.js` — decides which reminders are due and sends them
- `src/emails.js` — the email templates
- `src/scheduler.js` — runs the daily check
- `src/store.js`, `src/db.js` — the SQLite database (Node's built-in `node:sqlite`, no extra install)
- `public/` — the web interface (plain HTML/CSS/JS, no build step)
