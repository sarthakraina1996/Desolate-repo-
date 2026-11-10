# BrainADZ Events

Registration, passes, gate check-in, exhibitors, lead capture and live operations for Indian exhibitions, conferences and combined events. One server, one sign-in and one permission model behind every surface:

| Surface | Who it is for | Where |
|---|---|---|
| **iOS app** (Swift, SwiftUI) | Visitors, exhibitor booth staff, gate staff | `ios/` |
| **Android app** (Kotlin, Jetpack Compose) | Visitors, exhibitor booth staff, gate staff | `android/` |
| **Windows app** (WPF + WebView2) | Organisers, exhibitors, registration desks with a badge printer, venue screens | `windows/` |
| **Web** (React) | Public event site and registration, browser pass, organiser console, exhibitor workspace, gate scanner, venue displays | `web/` |
| **API** (Node.js, SQLite) | Everything above | `server/` |

The demo is **FutureWorks Expo**, a fictional three-day trade show with a conference track. All people, companies and numbers in it are made up.

## Run it

You need **Node.js 22.13 or newer**.

```bash
cd events
```

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3100. The first start loads the demo. `npm run seed` wipes the data and loads it again. On Windows you can double-click **`start-venue.bat`** instead; it installs, builds, starts the server and prints the address phones and displays on the venue Wi-Fi should use.

### Demo sign-ins

Password for all staff accounts: `Events@2026`. The sign-in page lists them and signs in with one click.

| Email | Role |
|---|---|
| organiser@futureworks.example | Organiser admin (everything) |
| ops@futureworks.example | Operations (no finance) |
| finance@futureworks.example | Finance |
| supervisor@futureworks.example | Gate supervisor (override, reprint, all gates) |
| gate1@ / gate2@ / gate3@futureworks.example | Gate staff, one gate each |
| ritu@novadisplays.example | Exhibitor admin, Nova Displays (booth A12) |
| karan@novadisplays.example | Booth staff, Nova Displays |
| farah@lumenworkspace.example | Exhibitor admin, Lumen Workspace (booth held, deposit unpaid) |

Visitors have no password. They sign in with a one-time email code, for example `aarav.mehta@meridianretail.example`. The demo's local email adapter delivers nothing, so the code is shown on screen, labelled as demo.

### What to look at

- **Visitor:** Register on the public site → enter the code → pass with QR. Try *Conference delegate* for the payment step (the hosted checkout page is the local demo adapter, clearly labelled) and *Media* for the review step.
- **Organiser** (`/org`): Live operations shows Gate 3 with 12 scans pending, 2 failed printer jobs, approvals waiting, a scan conflict and finance items to reconcile. Each links to the screen that resolves it.
- **Exhibitor** (`/x/1`): Booth A12, checklist, order summary, recent leads; **Scan a badge** is the one-handed lead capture view.
- **Gate** (`/gate`): choose a gate, then scan with the camera, a USB scanner or by typing a code. Turn the network off to see offline decisions and the queue; turn it back on to see the sync.
- **Venue display:** `/display/futureworks-expo/K1`.

## The apps

### Android

Kotlin + Jetpack Compose, CameraX with ML Kit's bundled barcode model, Android Keystore-encrypted storage, WorkManager for scan uploads. Needs JDK 17 and the Android SDK (platform 35).

```bash
cd events/android
```

```bash
./gradlew assembleDebug
```

The APK is at `app/build/outputs/apk/debug/app-debug.apk`. A debug build talks to `http://10.0.2.2:3100` (the emulator's name for your computer). On a real phone, open **Sign in → Server address** and enter the server's Wi-Fi address.

Release build and Google Play internal testing:

1. Create an upload keystore, then set `BRAINADZ_KEYSTORE`, `BRAINADZ_KEYSTORE_PASSWORD`, `BRAINADZ_KEY_ALIAS` and `BRAINADZ_KEY_PASSWORD` in the environment. No key material is stored in the repository.
2. `./gradlew bundleRelease -Pbrainadz.apiBaseUrl=https://your-server` and upload `app/build/outputs/bundle/release/app-release.aab` to an **Internal testing** track in Play Console.
3. App Links: set `ANDROID_CERT_SHA256` on the server to the app-signing certificate fingerprint from Play Console. The server then serves `/.well-known/assetlinks.json`.
4. Push: add the Firebase project's `google-services.json` to `android/app/`. Without it the app builds and runs with notifications switched off.

### iOS

Swift + SwiftUI, AVFoundation scanning, Keychain storage. Needs a Mac with Xcode 15 or newer and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
```

```bash
cd events/ios && xcodegen generate && open BrainADZEvents.xcodeproj
```

Choose a simulator and press Run; the debug build talks to `http://localhost:3100`. For a real iPhone and TestFlight:

1. In Xcode → Signing & Capabilities choose your team. The bundle id is `com.brainadz.events`.
2. In `project.yml` set `API_BASE_URL` and `LINK_HOST` to your server, and set `aps-environment` to `production` for release builds.
3. Universal Links: set `IOS_APP_ID` on the server to `<TeamID>.com.brainadz.events`. It serves `/.well-known/apple-app-site-association`.
4. Push: create an APNs key and set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_FILE` and `APNS_BUNDLE_ID` on the server.
5. Product → Archive → Distribute App → TestFlight.

### Windows

A native window for the web workspace. It adds what a browser cannot do well at a venue: **badges print straight to the badge printer chosen for that PC** with no dialog, **display mode** runs a venue screen full screen and retries by itself if the network drops, and the camera works for scanning without prompts. Needs Windows 10 or 11 and the .NET 8 SDK to build.

```bash
cd events/windows
```

```bash
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
```

Run `publish\BrainADZEvents.exe`. On first start it asks for the server address. **Settings** picks the badge printer. Tick *Use this computer as the badge print station* in the gate scanner to make the PC print every badge queued for its gate (set `PRINTER_ADAPTER=station` on the server). For a wall screen, start it with `BrainADZEvents.exe --display /display/futureworks-expo/K1`; leave display mode with Ctrl+Shift+Q.

### Built for you by GitHub Actions

`.github/workflows/events-build.yml` runs the tests and compiles all four targets on every push. Each run attaches the Android APK and the Windows app as downloadable artifacts (repository → Actions → latest run → Artifacts).

## Roles and what each may do

The server checks every request; the apps only hide what a role cannot use. A request for another organiser's event or another exhibitor's company answers "not found".

| Role | Scope | Can |
|---|---|---|
| Organiser admin | All events of the organiser | Everything, including staff, data removal and the audit log |
| Operations | One event | Registrations, approvals, exhibitors, booth allocation, floor plan, agenda, messages, gates, reports |
| Finance | One event | Orders, payments, reconciliation, refunds, invoice profile, finance reports, audit log |
| Gate supervisor | All gates of one event | Scan, lookup, print, **reprint** and **override** (reason required) |
| Gate staff | One gate | Scan, lookup, first badge print |
| Exhibitor admin | One company | Application, profile, orders and payment, team badges, leads, **lead export** |
| Booth staff | One company | Scan and view the company's leads |
| Visitor | Own registrations | Pass, cancel, pay, bookmarks, notification choices |

Route map (all under `/api/v1`):

| Routes | Who |
|---|---|
| `/public/*`, `/webhooks/payments/:provider` | No sign-in. Published events, registration, pass link, hosted checkout, signed provider callbacks, venue displays |
| `/auth/*`, `/me`, `/me/*` | Any signed-in person, for their own data |
| `/events/:slug/exhibitor-applications`, `/exhibitor/:id/*` | Members of that exhibitor company; team, orders and export need exhibitor admin |
| `/gate/*` | Gate roles and organiser staff with gate permissions, limited to their gates; `/gate/override` supervisors only |
| `/org/events/:id/*` | Organiser roles for that organiser and event, by permission (`reg.*`, `exh.*`, `floor.manage`, `agenda.manage`, `finance.*`, `gate.view`, `comms.manage`, `reports.*`, `staff.manage`, `data.purge`) |

Web pages: `/e/:slug` public site · `/p/:token` browser pass · `/signin` · `/account` · `/org/:eventId` console · `/x/:exhibitorId` workspace · `/gate` scanner · `/display/:slug/:kiosk` venue display.

## How the important parts work

- **Independent states.** A registration has a review state, a payment state and (from scans) an admission state. A pass is issued only when it is confirmed *and* nothing is owed.
- **Passes.** The QR is `BAE1.<opaque token>.<signature>`: a signed random reference with no personal details. Apps keep issued passes on the phone after the first download.
- **Payments.** Amounts are integer paise, shown in INR with Indian grouping. Checkout is hosted by the payment adapter. Callbacks are signature-checked, deduplicated on the provider's event id, and applied through one state machine, so a replayed or out-of-order callback changes nothing. Finance can record bank transfers, reconcile a stuck payment and record refunds; all are audited.
- **Booths.** A booth can have one live assignment (held or confirmed); the database enforces it, so two simultaneous confirmations produce one winner.
- **Offline check-in.** An enrolled device downloads a signed, time-limited eligibility set (pass token, pass type, holder name, revoked flag). Offline it decides from that set, queues each scan with a stable id, gate, device and time, and uploads on reconnect. Uploads are idempotent. The server replays scans in the order they happened: the earliest valid scan is the single counted entry and a second device that also showed "accepted" is flagged as a conflict. Restricted areas are never decided offline. A removed device is told to clear its data.
- **Printing.** A printer failure is its own state: the visitor stays admitted and staff retry or send the badge to the spare printer. A second badge is a reprint and needs a supervisor and a reason.
- **Leads.** Only pass types marked scannable can be captured, only the fields in the event's disclosed lead-sharing policy are copied, visitors can opt out, a visitor is one lead per exhibitor however often scanned, and every export is logged. Organisers see lead counts, never lead details.
- **Displays.** Read-only published data, a fixed "You are here" per kiosk, the time of the last update when offline, and no personal data.

The same scan rules run on the server and web (`shared/scanRules.js`), Android (`ScanRules.kt`) and iOS (`ScanRules.swift`).

## Runbook

**Before doors open**
1. Sign in on every gate phone on venue Wi-Fi, choose its gate, and wait for "Online · synced". That downloads the eligibility set.
2. On each desk PC open the gate scanner, pick the badge printer in Settings and print one test badge.
3. Open Live operations on the organiser's screen. Every gate should read Online.

**If the network drops**
- Keep scanning. The scanner shows "Offline · n queued" and decides from saved data. Unknown passes (registered after the last sync) go to the help desk.
- Scans upload by themselves when the connection returns; the sync button forces it. Do not sign a device out while it has queued scans.
- After reconnecting, check **Gates & printing → Scan conflicts**. Each conflict is a pass two devices accepted; it is counted once.
- The saved eligibility set lasts 12 hours (configurable). An expired set needs a reconnect before scanning.

**If a badge will not print**
- The scanner says what is wrong ("Out of labels"). The visitor is already admitted; let them through.
- Fix the printer and press **Retry**, or press **Use spare printer**. Both are recorded.
- Reprints (lost or torn badges) need a supervisor and a reason.

**If a pass is refused**
- Wrong area, expired, cancelled and already-used passes show the reason and "What to do". Look the person up by name, or a supervisor can override with a reason. Otherwise send them to the help desk, where staff can register them on the spot.

**If a phone is lost** — Organiser console → Gates & printing → Remove the device. It loses access at once and clears its saved data on next contact.

## Configuration

Copy `.env.example` to `.env`. Provider credentials are read only from server-side environment variables.

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST`, `DATA_DIR` | `3100`, `0.0.0.0`, `./data` | Where the server listens and keeps its database and uploads (use a persistent disk) |
| `SEED` | `demo` | `empty` starts with one organiser and `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| `PUBLIC_URL` | request host | Address used in emailed links |
| `APP_SECRET` | generated | Signs order links |
| `COOKIE_SECURE`, `TRUST_PROXY` | | Set to `true` / `1` behind HTTPS |
| `EMAIL_ADAPTER=smtp` + `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | local | Real email |
| `PAYMENT_ADAPTER=razorpay` + `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | local | Hosted UPI and card checkout. Point the provider's webhook at `/api/v1/webhooks/payments/razorpay` |
| `PRINTER_ADAPTER=station` | local | Badge jobs wait for a Windows print station |
| `APNS_*`, `FCM_SERVICE_ACCOUNT_FILE` | local | Push notifications |
| `WHATSAPP_ADAPTER=cloud` + `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | off | Optional WhatsApp pass link, opt-in only |
| `IOS_APP_ID`, `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` | | App-link verification files |
| `DEMO_SHOW_CODES=false` | | Never show one-time codes on screen |

`npm run migrate` applies database migrations (`server/migrations/`); starting the server does the same. The stack follows this repository's existing conventions (Node.js, Express, SQLite through `node:sqlite`, React). For a hosted multi-server deployment, move the schema to PostgreSQL: the SQL is standard apart from the partial unique indexes, which PostgreSQL also supports.

## Privacy disclosures for the app stores

- **Collected:** name, email, optional phone, company, job title and the organiser's registration questions. Camera frames are processed on the device to read QR codes and are not stored or sent. Push tokens are stored only after opt-in.
- **Shared:** with an exhibitor only when the visitor lets their badge be scanned, limited to the fields in the event's lead-sharing notice, with an opt-out at registration.
- **On the device:** session token and device key in Keychain / Keystore; passes, event guide and scan queue in app-private storage; all cleared on sign-out or device removal.
- **Retention:** set per event (Settings → Privacy & data). After it passes, an administrator can remove personal data; counts and money totals remain.
- **Payments:** physical event passes are paid on the provider's hosted checkout in the browser. Check Apple and Google Play billing rules before selling livestreams or other digital-only content inside the apps.

## Test results and what is confirmed

| Check | Result |
|---|---|
| Acceptance checks from the brief (`npm test`, 7 tests): visitor to entry incl. wrong-zone, expired and repeat scans; exhibitor to deduplicated lead export; one booth for two confirmations; replayed and out-of-order payment callbacks; two offline devices with a conflict counted once; printer failure recovery; cross-tenant, cross-exhibitor and role permissions | Pass |
| Web: every surface walked through in Chromium at phone and desktop widths, including scanning offline and re-syncing | Pass, no page errors |
| Android: debug and minified release builds | Compile. Not yet run on a physical phone |
| iOS and Windows | Compiled by the GitHub Actions workflow, not in the development container. Not yet run on a device |

**Not confirmed, do before the pilot:** camera scanning on physical iPhones and Android phones; the actual badge printer models with the Windows print station; venue Wi-Fi and a 30-minute offline rehearsal with two devices; Razorpay in test mode; SMTP delivery; APNs and FCM with real credentials; VoiceOver and TalkBack passes on the native apps. The Razorpay, SMTP, APNs, FCM and WhatsApp adapters are written to the providers' documented APIs but have not been exercised against the live services.

## Not built yet

These are the brief's post-pilot modules. The data model and permissions leave room for them: sellable floor plan with contracts and instalments; contractor access and loading slots; buyer-exhibitor meetings and hosted buyers; speaker management, session scanning, Q&A, polls and certificates; sponsorship inventory; referral campaigns; edition cloning; CRM and accounting connectors; multilingual content; SSO and white-label; indoor routing.
