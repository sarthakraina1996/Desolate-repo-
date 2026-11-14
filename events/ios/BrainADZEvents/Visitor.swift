// Visitor screens: Pass, Explore, Agenda, Profile, plus sign-in and registration.
import SwiftUI
import UserNotifications

// MARK: Pass
// The pass as its holder shows it: quiet, high-contrast QR with the gate and area beside it.
struct PassCard: View {
    let pass: Pass
    var body: some View {
        Panel {
            VStack(spacing: 12) {
                Text(pass.passClass.name).font(.body.weight(.semibold)).foregroundColor(.petrol)
                    .padding(.horizontal, 14).padding(.vertical, 4)
                    .background(Color.selectedFill, in: RoundedRectangle(cornerRadius: 6))
                VStack(spacing: 2) {
                    Text(pass.holderName).font(.title.weight(.semibold)).multilineTextAlignment(.center)
                    if let company = pass.holderCompany { Text(company).foregroundColor(.ink2) }
                }
                if let qr = pass.qr {
                    QrImage(text: qr, label: "QR code for \(pass.holderName)'s pass").frame(width: 232, height: 232)
                } else {
                    Notice(text: "This pass is no longer valid.", tone: .error)
                }
                HStack(spacing: 8) {
                    KeyValue(key: "Enter at", value: pass.gates.isEmpty ? "Any gate" : pass.gates.joined(separator: ", "))
                    KeyValue(key: "Valid for", value: pass.zones.joined(separator: ", "))
                }
                Text("\(Fmt.dateRange(pass.validFrom, pass.validTo)) · \(pass.event.openTime)–\(pass.event.closeTime)\(pass.ref.map { " · Ref \($0)" } ?? "")")
                    .font(.subheadline).foregroundColor(.ink2).multilineTextAlignment(.center)
                Text(pass.instructions).foregroundColor(.ink2).multilineTextAlignment(.center)
            }
            .padding(20)
        }
    }
}

// Where a registration stands, and the one thing to do next.
struct RegistrationCard: View {
    let reg: Registration
    @EnvironmentObject var repo: Repo
    @Environment(\.openURL) var openURL
    @StateObject var action = ActionRunner()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "\(reg.event.name) · \(reg.passClass.name)")
            switch reg.step {
            case "pass":
                if let pass = reg.pass { PassCard(pass: pass) }
                if reg.pass?.firstAdmittedAt != nil { Notice(text: "Admitted. Keep this pass for re-entry.", tone: .ok) }
            case "payment":
                Notice(text: "Payment needed. Your \(reg.passClass.name) place is held; the pass is issued as soon as payment is confirmed.\(reg.paymentStatus == "failed" ? " The last attempt did not go through." : "")", tone: .pending)
                if let order = reg.order {
                    Panel {
                        ForEach(order.items, id: \.self) { item in
                            ListRow { Text(item.description); Spacer(); Text(Fmt.inr(item.amountPaise)).monospacedDigit() }
                            Rule()
                        }
                        ListRow { Text("GST"); Spacer(); Text(Fmt.inr(order.gstPaise)).monospacedDigit() }
                        Rule()
                        ListRow { Text("Total").bold(); Spacer(); Text(Fmt.inr(order.balancePaise)).bold().monospacedDigit() }
                    }
                    // Physical event tickets are paid on the provider's hosted checkout, in the browser.
                    Button("Pay \(Fmt.inr(order.balancePaise))") {
                        action.run {
                            let url = try await repo.checkoutUrl(order)
                            openURL(url)
                        }
                    }
                        .buttonStyle(PrimaryButtonStyle()).disabled(action.busy)
                    Text("You pay on a secure hosted checkout page by UPI or card. Come back here afterwards; your pass appears once payment is confirmed.")
                        .font(.subheadline).foregroundColor(.ink2)
                }
            case "review":
                Notice(text: "Awaiting review. The organiser reviews \(reg.passClass.name) registrations and will email \(reg.email) with a decision. Reference \(reg.ref).", tone: .pending)
            case "rejected":
                Notice(text: "Not approved. \(reg.reviewNote ?? "The organiser could not approve this registration.") Reference \(reg.ref).", tone: .error)
            default:
                Notice(text: "Cancelled. This registration (\(reg.ref)) was cancelled and its pass no longer works.", tone: .error)
            }
            if ["pass", "payment", "review"].contains(reg.step) {
                Button("Cancel registration") { action.run { try await repo.cancel(reg) } }.buttonStyle(LinkButtonStyle())
            }
        }
        .messages(action)
    }
}

struct PassScreen: View {
    @EnvironmentObject var repo: Repo
    let onRegister: () -> Void
    let onSignIn: () -> Void
    @State var brightness = UIScreen.main.brightness
    var body: some View {
        let regs = repo.passes.registrations.isEmpty ? [repo.linked].compactMap { $0 } : repo.passes.registrations
        Screen {
            ScreenTitle(title: regs.count + repo.passes.badges.count == 1 ? "My ticket" : "My tickets", eyebrow: repo.guide?.event.name)
            if !repo.online {
                Notice(text: "Offline. Showing the tickets saved on this phone\(repo.passes.syncedAt.isEmpty ? "" : ", last updated \(Fmt.clock(repo.passes.syncedAt))").", tone: .pending)
            }
            ForEach(repo.passes.badges) { PassCard(pass: $0) }
            ForEach(regs) { RegistrationCard(reg: $0) }
            if regs.isEmpty && repo.passes.badges.isEmpty {
                Text("You have no ticket yet. Register for \(repo.guide?.event.name ?? "the event"), or sign in to load a ticket you already have.").foregroundColor(.ink2)
                Button("Register", action: onRegister).buttonStyle(PrimaryButtonStyle())
                Button(repo.signedIn ? "Refresh" : "Sign in or find my ticket", action: onSignIn).buttonStyle(SecondaryButtonStyle())
            }
        }
        .refreshable { await repo.start() }
        // Full brightness while the QR is on screen makes it easier to scan at the gate.
        .onAppear { brightness = UIScreen.main.brightness; UIScreen.main.brightness = 1 }
        .onDisappear { UIScreen.main.brightness = brightness }
    }
}

// MARK: Explore
struct ExhibitorCard: View {
    let ex: Exhibitor
    var onShowOnPlan: (() -> Void)?
    @Environment(\.openURL) var openURL
    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: ex.name)
                Text(ex.hall.map { "\($0) · Booth \(ex.boothCode ?? "")" } ?? "Booth to be announced").foregroundColor(.ink2)
                if let text = ex.description { Text(text) }
                if !ex.categories.isEmpty { Text(ex.categories.joined(separator: " · ")).font(.subheadline).foregroundColor(.ink2) }
                if let show = onShowOnPlan, ex.boothId != nil { Button("Show on plan", action: show).buttonStyle(SecondaryButtonStyle()) }
                ForEach((ex.website.map { [WebLink(label: "Website", url: $0)] } ?? []) + ex.catalogueLinks, id: \.self) { link in
                    if let url = URL(string: link.url) { Button(link.label) { openURL(url) }.buttonStyle(SecondaryButtonStyle()) }
                }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct ExploreScreen: View {
    let guide: Guide
    @EnvironmentObject var repo: Repo
    @State var query = ""
    @State var showMap = true
    @State var hallId: Int?
    @State var boothId: Int?
    @State var open: Int?
    var body: some View {
        let halls = guide.halls.filter { $0.cols > 0 }
        let hall = halls.first { $0.id == hallId } ?? halls.first
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let matches = guide.exhibitors.filter { e in
            q.isEmpty || ([e.name, e.boothCode ?? "", e.industry ?? ""] + e.categories).contains { $0.lowercased().contains(q) }
        }
        Screen {
            ScreenTitle(title: "Explore", eyebrow: guide.event.name)
            LabeledField(label: "Search exhibitors", text: $query, hint: "Company, booth or product")
                .onChange(of: query) { value in if !value.isEmpty { showMap = false } }
            HStack(spacing: 8) {
                Chip(text: "Map", selected: showMap) { showMap = true }
                Chip(text: "List", selected: !showMap) { showMap = false }
            }
            if showMap, let hall = hall {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(halls) { h in Chip(text: h.name, selected: h.id == hall.id) { hallId = h.id; boothId = nil } } }
                }
                Panel { HallPlan(hall: hall, selected: boothId) { b in boothId = b.exhibitorId != nil ? b.id : nil }.padding(12) }
                if let ex = guide.exhibitors.first(where: { $0.boothId == boothId && boothId != nil }) {
                    ExhibitorCard(ex: ex)
                } else {
                    Text("Tap a booth to see who is there. Dashed booths are not allocated.").foregroundColor(.ink2)
                }
                if !hall.amenities.isEmpty {
                    Panel {
                        ForEach(hall.amenities) { a in
                            ListRow { Text(a.label); Spacer(); if a.accessible { StatusChip(text: "Step-free", tone: .ok) } }
                            Rule()
                        }
                    }
                }
            } else {
                Text("\(matches.count) of \(guide.exhibitors.count) exhibitors").font(.subheadline).foregroundColor(.ink2)
                Panel {
                    ForEach(matches) { e in
                        Button { open = open == e.id ? nil : e.id } label: {
                            ListRow {
                                Text(e.boothCode ?? "—").bold().frame(width: 48, alignment: .leading)
                                VStack(alignment: .leading) {
                                    Text(e.name).bold()
                                    Text([e.hall, e.industry].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundColor(.ink2)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        if open == e.id {
                            ExhibitorCard(ex: e) {
                                hallId = halls.first { h in h.booths.contains { $0.id == e.boothId } }?.id
                                boothId = e.boothId; showMap = true; query = ""
                            }
                            .padding(12)
                        }
                        Rule()
                    }
                    if matches.isEmpty { Text("No exhibitors match. Try a different search.").foregroundColor(.ink2).padding(24) }
                }
            }
            if !repo.online { Text("Offline. Showing the guide saved \(Fmt.clock(guide.savedAt)).").font(.subheadline).foregroundColor(.pendingText) }
        }
    }
}

// MARK: Agenda
struct AgendaScreen: View {
    let guide: Guide
    @EnvironmentObject var repo: Repo
    @State var track: Int?
    @State var mine = false
    @StateObject var action = ActionRunner()
    var body: some View {
        let sessions = guide.agenda.sessions.filter { $0.status == "scheduled" && (track == nil || $0.trackId == track) && (!mine || repo.bookmarks.contains($0.id)) }
        let days = Array(Set(sessions.map { $0.day })).sorted()
        Screen {
            ScreenTitle(title: "Agenda", eyebrow: guide.event.name)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(text: "All", selected: track == nil && !mine) { track = nil; mine = false }
                    ForEach(guide.agenda.tracks) { t in Chip(text: t.name, selected: track == t.id) { track = t.id; mine = false } }
                    if repo.signedIn { Chip(text: "My bookmarks", selected: mine) { mine.toggle(); track = nil } }
                }
            }
            if !repo.signedIn { Text("Sign in from Profile to bookmark sessions.").font(.subheadline).foregroundColor(.ink2) }
            ForEach(days, id: \.self) { d in
                SectionTitle(text: Fmt.weekday(d))
                Panel {
                    ForEach(sessions.filter { $0.day == d }) { s in
                        let marked = repo.bookmarks.contains(s.id)
                        ListRow {
                            VStack(alignment: .leading) {
                                Text(s.startTime).bold().monospacedDigit()
                                Text(s.endTime).font(.subheadline).foregroundColor(.ink2).monospacedDigit()
                            }
                            .frame(width: 56, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.title).bold()
                                Text([s.room, s.track].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundColor(.ink2)
                                if !s.speakers.isEmpty {
                                    Text(s.speakers.map { p in p.title.map { "\(p.name), \($0)" } ?? p.name }.joined(separator: "; ")).font(.subheadline)
                                }
                                if s.full { StatusChip(text: "Full", tone: .pending) }
                            }
                            Spacer(minLength: 0)
                            if repo.signedIn {
                                Button { action.run { try await repo.toggleBookmark(s.id) } } label: {
                                    Image(systemName: marked ? "bookmark.fill" : "bookmark").foregroundColor(.petrol).frame(width: 44, height: 44)
                                }
                                .accessibilityLabel(marked ? "Remove bookmark for \(s.title)" : "Bookmark \(s.title)")
                            }
                        }
                        Rule()
                    }
                }
            }
            if sessions.isEmpty { Text(mine ? "You have not bookmarked any sessions yet." : "No sessions to show.").foregroundColor(.ink2) }
        }
        .messages(action)
    }
}

// MARK: Profile
struct ProfileScreen: View {
    @EnvironmentObject var repo: Repo
    let modes: [(Mode, String)]
    let mode: Mode
    let onMode: (Mode) -> Void
    let onSignIn: () -> Void
    @StateObject var action = ActionRunner()

    // Turning a notification on asks for permission first, then registers this phone's APNs
    // token with the chosen topics. Nothing is sent until the person opts in.
    func toggle(_ topic: String, _ on: Bool) {
        let next = on ? repo.pushTopics + [topic] : repo.pushTopics.filter { $0 != topic }
        action.run {
            if on {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                guard granted else { throw ApiError(status: 403, message: "Notifications are blocked. Allow them in Settings.") }
                UIApplication.shared.registerForRemoteNotifications()
                // The token arrives through the app delegate a moment later.
                for _ in 0..<20 where repo.pushToken == nil { try await Task.sleep(nanoseconds: 250_000_000) }
            }
            try await repo.setPush(topics: next)
        }
    }

    var body: some View {
        Screen {
            ScreenTitle(title: "Profile")
            Panel {
                if repo.signedIn {
                    ListRow { VStack(alignment: .leading) { Text(repo.me.user?.name ?? "Signed in").bold(); Text(repo.me.user?.email ?? "").foregroundColor(.ink2) } }
                    Rule()
                    Button { action.run { await repo.signOut() } } label: { ListRow { Text("Sign out and clear this phone").foregroundColor(.errorText) } }.buttonStyle(.plain)
                } else {
                    Button(action: onSignIn) { ListRow { Text("Sign in").bold().foregroundColor(.petrol) } }.buttonStyle(.plain)
                }
            }
            if modes.count > 1 {
                SectionTitle(text: "Workspaces")
                Panel {
                    ForEach(modes, id: \.0) { m, label in
                        Button { onMode(m) } label: {
                            ListRow {
                                Image(systemName: m == mode ? "largecircle.fill.circle" : "circle").foregroundColor(.petrol)
                                Text(label)
                            }
                        }
                        .buttonStyle(.plain).accessibilityAddTraits(m == mode ? .isSelected : [])
                        Rule()
                    }
                }
            }
            if repo.signedIn {
                SectionTitle(text: "Notifications")
                Panel {
                    ForEach([("schedule", "Schedule changes"), ("gate", "Gate changes")], id: \.0) { topic, label in
                        Toggle(label, isOn: Binding(get: { repo.pushTopics.contains(topic) }, set: { toggle(topic, $0) }))
                            .tint(.petrol).padding(.horizontal, 16).frame(minHeight: 50)
                        Rule()
                    }
                }
                Text("Off until you turn them on. You can change this at any time.").font(.subheadline).foregroundColor(.ink2)
            }
            if let guide = repo.guide {
                SectionTitle(text: guide.event.name)
                Panel {
                    ListRow {
                        VStack(alignment: .leading) {
                            Text("\(Fmt.dateRange(guide.event.startsOn, guide.event.endsOn)) · \(guide.event.openTime)–\(guide.event.closeTime)").bold()
                            Text([guide.event.venueName, guide.event.venueAddress].compactMap { $0 }.joined(separator: ", ")).foregroundColor(.ink2)
                        }
                    }
                    if let text = guide.accessibility {
                        Rule()
                        ListRow { VStack(alignment: .leading) { Text("Accessibility").bold(); Text(text).foregroundColor(.ink2) } }
                    }
                    ForEach(guide.faqs, id: \.self) { f in
                        Rule()
                        ListRow { VStack(alignment: .leading) { Text(f.q).bold(); Text(f.a).foregroundColor(.ink2) } }
                    }
                }
            }
            Text("BrainADZ Events \(Foundation.Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") · \(repo.serverUrl)")
                .font(.subheadline).foregroundColor(.ink2)
        }
        .messages(action)
    }
}

// MARK: Sign in
struct SignInScreen: View {
    let onDone: () -> Void
    var body: some View {
        Screen {
            ScreenTitle(title: "Sign in", eyebrow: "BrainADZ Events")
            SignInFields(onDone: onDone)
        }
    }
}

// Email-code or password sign-in, plus the ticket-link and server-address options. Used on the
// welcome screen and the sign-in sheet.
struct SignInFields: View {
    @EnvironmentObject var repo: Repo
    let onDone: () -> Void
    @State var email = ""
    @State var secret = ""
    @State var usePassword = false
    @State var sent = false
    @State var demoCode: String?
    @State var server = ""
    @State var showServer = false
    @State var findPass = false
    @StateObject var action = ActionRunner()
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LabeledField(label: "Email", text: $email, keyboard: .emailAddress)
                .onChange(of: email) { _ in sent = false }
            if usePassword { LabeledField(label: "Password", text: $secret, secure: true) }
            if !usePassword && sent {
                if let code = demoCode { Notice(text: "Demo: the local email adapter sends nothing. Your code is \(code).", tone: .pending) }
                LabeledField(label: "6-digit code", text: $secret, hint: "Sent to \(email)", keyboard: .numberPad)
            }
            Button(usePassword || sent ? "Sign in" : "Email me a code") {
                action.run {
                    if usePassword { try await repo.signIn(email: email, password: secret); onDone() }
                    else if !sent { demoCode = try await repo.requestCode(email: email).demoCode; sent = true; secret = "" }
                    else { try await repo.verifyCode(email: email, code: secret); onDone() }
                }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(action.busy || !email.contains("@"))
            Button(usePassword ? "Email me a code instead" : "Use a password instead") { usePassword.toggle(); secret = ""; sent = false }.buttonStyle(LinkButtonStyle())
            if repo.slug != nil {
                Button("Registered without an account? Email my ticket link") { findPass = true }.buttonStyle(LinkButtonStyle())
            }
            if findPass {
                Notice(text: "Enter the email you registered with above, then tap Send. The link opens your ticket in this app.")
                Button("Send my ticket link") {
                    action.run { try await repo.passLink(email: email); action.message = "If that email is registered, a new ticket link is on its way." }
                }
                .buttonStyle(SecondaryButtonStyle()).disabled(!email.contains("@"))
            }
            Button("Server address") { server = repo.serverUrl; showServer.toggle() }.buttonStyle(LinkButtonStyle())
            if showServer {
                LabeledField(label: "Server address", text: $server, hint: "For pilots and venue networks, for example http://192.168.1.20:3100", keyboard: .URL)
                Button("Use this server") { repo.serverUrl = server; action.run { await repo.start() } }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .messages(action)
    }
}

// MARK: Register
// Single-column form, persistent labels, inline errors, visible privacy notice, then a code
// step that proves the email address.
struct RegisterScreen: View {
    let guide: Guide
    let onDone: () -> Void
    @EnvironmentObject var repo: Repo
    @State var passClass = ""
    @State var name = ""
    @State var email = ""
    @State var phone = ""
    @State var company = ""
    @State var jobTitle = ""
    @State var invite = ""
    @State var texts: [String: String] = [:]
    @State var ticks: [String: Bool] = [:]
    @State var consent = false
    @State var optOut = false
    @State var errors: [String: String] = [:]
    @State var pending: RegisterOut?
    @State var code = ""
    @StateObject var action = ActionRunner()

    var cls: PassClass? { guide.passClasses.first { $0.code == passClass } }
    var cta: String {
        guard let c = cls else { return "Register" }
        if c.mode == "approval" { return "Submit for review" }
        if c.totalPaise > 0 { return "Continue to payment" }
        return "Get \(c.name.lowercased()) pass"
    }
    func submit() {
        var e: [String: String] = [:]
        if name.trimmingCharacters(in: .whitespaces).isEmpty { e["name"] = "Enter your full name" }
        if email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) == nil { e["email"] = "Enter a work email address, like name@company.com" }
        if cls?.mode == "invited" && invite.isEmpty { e["invite"] = "Enter the code from your invitation" }
        for f in guide.formFields where f.required {
            if f.type == "checkbox" ? ticks[f.key] != true : (texts[f.key] ?? "").isEmpty { e[f.key] = f.type == "checkbox" ? "Tick this box to continue" : "Choose an answer" }
        }
        if !consent { e["consent"] = "Accept the privacy notice to register" }
        errors = e
        guard e.isEmpty else { return }
        var answers: [String: Any] = texts.filter { !$0.value.isEmpty }
        for (k, v) in ticks { answers[k] = v }
        action.run {
            pending = try await repo.register([
                "passClass": passClass, "name": name, "email": email, "phone": phone, "company": company, "jobTitle": jobTitle,
                "inviteCode": invite, "consent": true, "leadOptOut": optOut, "answers": answers,
            ])
        }
    }

    var body: some View {
        Screen {
            if let p = pending {
                ScreenTitle(title: "Check your email", eyebrow: guide.event.name)
                Text("We sent a 6-digit code to \(p.email). Enter it to confirm the address is yours.")
                if let demo = p.demoCode { Notice(text: "Demo: the local email adapter sends nothing. Your code is \(demo).", tone: .pending) }
                LabeledField(label: "6-digit code", text: $code, keyboard: .numberPad)
                Button("Confirm") { action.run { try await repo.verifyRegistration(ref: p.ref, code: code); onDone() } }
                    .buttonStyle(PrimaryButtonStyle()).disabled(action.busy || code.count != 6)
                Button("Send a new code") { action.run { pending?.demoCode = try await repo.resendCode(ref: p.ref).demoCode } }.buttonStyle(LinkButtonStyle())
            } else {
                ScreenTitle(title: "Register", eyebrow: guide.event.name)
                Text("Pass type").bold()
                Panel {
                    ForEach(guide.passClasses) { c in
                        Button { passClass = c.code } label: {
                            ListRow(fill: c.code == passClass ? .selectedFill : .surface) {
                                Image(systemName: c.code == passClass ? "largecircle.fill.circle" : "circle").foregroundColor(.petrol)
                                VStack(alignment: .leading) {
                                    Text(c.name).bold()
                                    Text(c.soldOut ? "Fully booked" : c.description ?? "").font(.subheadline).foregroundColor(.ink2)
                                }
                                Spacer(minLength: 0)
                                Text(c.mode == "invited" ? "Invitation" : c.mode == "approval" ? "Reviewed" : c.priceLabel)
                            }
                        }
                        .buttonStyle(.plain).disabled(c.soldOut)
                        .accessibilityAddTraits(c.code == passClass ? .isSelected : [])
                        Rule()
                    }
                }
                Text("Exhibitors apply for a stand on the event website. Speakers are registered by the organiser.").font(.subheadline).foregroundColor(.ink2)
                if cls?.mode == "invited" { LabeledField(label: "Invitation code", text: $invite, error: errors["invite"], keyboard: .asciiCapable) }
                LabeledField(label: "Full name", text: $name, hint: "As it should appear on your badge", error: errors["name"])
                LabeledField(label: "Work email", text: $email, hint: "We send your pass here", error: errors["email"], keyboard: .emailAddress)
                LabeledField(label: "Mobile number (optional)", text: $phone, keyboard: .phonePad)
                LabeledField(label: "Company (optional)", text: $company)
                LabeledField(label: "Job title (optional)", text: $jobTitle)
                ForEach(guide.formFields) { f in
                    if f.type == "checkbox" {
                        CheckRow(label: f.label, isOn: Binding(get: { ticks[f.key] ?? false }, set: { ticks[f.key] = $0 }), error: errors[f.key])
                    } else if f.type == "select" {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(f.label).bold()
                            Panel {
                                ForEach(f.options, id: \.self) { o in
                                    Button { texts[f.key] = o } label: {
                                        ListRow { Image(systemName: texts[f.key] == o ? "largecircle.fill.circle" : "circle").foregroundColor(.petrol); Text(o) }
                                    }
                                    .buttonStyle(.plain).accessibilityAddTraits(texts[f.key] == o ? .isSelected : [])
                                    Rule()
                                }
                            }
                            if let err = errors[f.key] { Text(err).font(.subheadline.weight(.medium)).foregroundColor(.errorText) }
                        }
                    } else {
                        LabeledField(label: f.label, text: Binding(get: { texts[f.key] ?? "" }, set: { texts[f.key] = $0 }), error: errors[f.key])
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("How we use your details").bold()
                    Text("We use them to issue your pass and run the event. \(guide.leadSharingNotice)").font(.subheadline)
                    CheckRow(label: "Do not share my details with exhibitors, even if they scan my badge", isOn: $optOut, error: nil)
                    CheckRow(label: "I accept this privacy notice", isOn: $consent, error: errors["consent"])
                }
                .padding(12).background(Color.selectedFill, in: RoundedRectangle(cornerRadius: 6))
                Button(cta, action: submit).buttonStyle(PrimaryButtonStyle()).disabled(action.busy || cls == nil)
                if !errors.isEmpty { Notice(text: "Check the highlighted answers above.", tone: .error) }
            }
        }
        .onAppear { if passClass.isEmpty { passClass = guide.passClasses.first { !$0.soldOut }?.code ?? "" } }
        .messages(action)
    }
}

struct CheckRow: View {
    let label: String
    @Binding var isOn: Bool
    let error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { isOn.toggle() } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: isOn ? "checkmark.square.fill" : "square").font(.title3).foregroundColor(.petrol)
                    Text(label).foregroundColor(.ink).multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label).accessibilityValue(isOn ? "Ticked" : "Not ticked").accessibilityAddTraits(.isButton)
            if let error = error { Text(error).font(.subheadline.weight(.medium)).foregroundColor(.errorText) }
        }
    }
}
