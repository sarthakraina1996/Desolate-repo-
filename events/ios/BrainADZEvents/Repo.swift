// App state and the operations the screens call. Passes, the event guide and the gate scan
// queue are cached on the device so the app keeps working without a connection; everything
// is cleared on sign-out or when the server revokes this device.
import CryptoKit
import Foundation
import Network
import UIKit

@MainActor
final class Repo: ObservableObject {
    static let shared = Repo()

    @Published var ready = false
    @Published var me = Me()
    @Published var passes = MyPasses()
    // A registration opened from a pass link, for visitors who have not signed in.
    @Published var linked: Registration?
    @Published var guide: Guide?
    @Published var bookmarks: Set<Int> = []

    @Published var device: Device?
    @Published var bundle: Eligibility?
    @Published var queue: [QueuedScan] = []
    @Published var online = true
    @Published var syncing = false
    @Published var pushTopics: [String] = []

    private let monitor = NWPathMonitor()
    var signedIn: Bool { me.user != nil }
    var slug: String? { guide?.event.slug }

    private init() {
        let configured = Foundation.Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String ?? ""
        Api.baseUrl = Keychain.get("server") ?? configured
        Api.token = Keychain.get("token")
        // Show cached data at once; the network refresh follows in start().
        passes = Files.load("passes.json") ?? MyPasses()
        linked = Files.load("linked.json")
        guide = Files.load("guide.json")
        device = Keychain.get("device").flatMap { try? JSONDecoder().decode(Device.self, from: Data($0.utf8)) }
        bundle = Files.load("bundle.json")
        queue = Files.load("queue.json") ?? []
        pushTopics = (Keychain.get("pushTopics") ?? "").split(separator: ",").map(String.init)
        // Upload queued scans as soon as a connection comes back.
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                if !self.queue.isEmpty || !self.online { await self.sync() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "network"))
    }

    var serverUrl: String {
        get { Api.baseUrl }
        set {
            var value = newValue.trimmingCharacters(in: .whitespaces)
            while value.hasSuffix("/") { value.removeLast() }
            Api.baseUrl = value
            Keychain.set("server", value)
        }
    }

    // Called at launch and whenever the app returns to the foreground.
    func start() async {
        do {
            if Api.token != nil { try await refreshMe() }
            if signedIn {
                try await refreshPasses()
                try await loadBookmarks()
            }
            if let link = Keychain.get("passLink") { try? await openPassLink(link) }
            var known = slug ?? passes.registrations.first?.event.slug
            if known == nil {
                let events: [EventInfo] = try await Api.get("/public/events")
                known = events.first?.slug
            }
            if let known = known { try await loadGuide(known) }
            online = true
        } catch let e as ApiError {
            if e.offline { online = false }
            if e.status == 401 { localSignOut() }
        } catch {}
        ready = true
        if device != nil { await sync() }
    }

    // MARK: Session
    func refreshMe() async throws { me = try await Api.get("/me") }
    private func signedIn(with out: SessionOut) async throws {
        Api.token = out.token
        Keychain.set("token", out.token)
        try await refreshMe()
        try await refreshPasses()
        try await loadBookmarks()
    }
    private func loadBookmarks() async throws {
        let ids: [Int] = try await Api.get("/me/bookmarks")
        bookmarks = Set(ids)
    }
    func signIn(email: String, password: String) async throws {
        let out: SessionOut = try await Api.post("/auth/login", ["email": email, "password": password, "client": "ios"])
        try await signedIn(with: out)
    }
    func requestCode(email: String) async throws -> CodeOut { try await Api.post("/auth/code", ["email": email]) }
    func verifyCode(email: String, code: String) async throws {
        let out: SessionOut = try await Api.post("/auth/code/verify", ["email": email, "code": code, "client": "ios"])
        try await signedIn(with: out)
    }
    // Signs out and purges everything cached on this device.
    func signOut() async {
        _ = try? await Api.raw("POST", "/auth/logout")
        localSignOut()
    }
    private func localSignOut() {
        let server = Api.baseUrl
        Api.token = nil
        Keychain.clear()
        Keychain.set("server", server)
        Files.clear()
        me = Me(); passes = MyPasses(); linked = nil; bookmarks = []
        device = nil; bundle = nil; queue = []; pushTopics = []
    }

    // MARK: Visitor
    func refreshPasses() async throws {
        passes = try await Api.get("/me/passes")
        Files.save("passes.json", passes)
    }
    // Downloads the guide only when the server has a newer version than the cached copy.
    func loadGuide(_ slug: String) async throws {
        let have = guide?.event.slug == slug ? guide?.version ?? 0 : 0
        let data = try await Api.raw("GET", "/public/events/\(slug)/guide?have=\(have)")
        let check: GuideCheck = try Api.decode(data)
        if check.unchanged != true { guide = try Api.decode(data) }
        guide?.savedAt = ScanRules.nowIso()
        if let guide = guide { Files.save("guide.json", guide) }
    }
    func toggleBookmark(_ sessionId: Int) async throws {
        if bookmarks.contains(sessionId) {
            try await Api.raw("DELETE", "/me/bookmarks/\(sessionId)")
            bookmarks.remove(sessionId)
        } else {
            try await Api.raw("PUT", "/me/bookmarks/\(sessionId)")
            bookmarks.insert(sessionId)
        }
    }
    func register(_ fields: [String: Any?]) async throws -> RegisterOut {
        var body = fields
        body["client"] = "ios"
        return try await Api.post("/public/events/\(slug ?? "")/registrations", body)
    }
    func resendCode(ref: String) async throws -> CodeOut { try await Api.post("/public/events/\(slug ?? "")/registrations/\(ref)/resend-code") }
    func verifyRegistration(ref: String, code: String) async throws {
        let out: VerifyOut = try await Api.post("/public/events/\(slug ?? "")/registrations/\(ref)/verify", ["code": code, "client": "ios"])
        try await signedIn(with: SessionOut(token: out.token, user: nil))
    }
    func passLink(email: String) async throws { try await Api.raw("POST", "/public/events/\(slug ?? "")/pass-link", ["email": email]) }
    // Opens a pass retrieval link and keeps the pass for offline use.
    func openPassLink(_ token: String) async throws {
        let reg: Registration = try await Api.get("/public/pass/\(token)")
        Keychain.set("passLink", token)
        linked = reg
        Files.save("linked.json", reg)
    }
    func cancel(_ reg: Registration) async throws {
        if signedIn {
            try await Api.raw("POST", "/me/registrations/\(reg.id)/cancel")
            try await refreshPasses()
        } else if let link = Keychain.get("passLink") {
            try await Api.raw("POST", "/public/pass/\(link)/cancel")
            try await openPassLink(link)
        }
    }
    // Hosted checkout address for an unpaid registration; opened in the browser.
    func checkoutUrl(_ order: Order) async throws -> URL {
        let out: CheckoutOut = try await Api.post("/public/orders/\(order.token ?? "")/checkout", ["returnPath": "/account"])
        guard let url = URL(string: out.url.hasPrefix("http") ? out.url : Api.baseUrl + out.url) else {
            throw ApiError(status: 500, message: "The checkout address is not valid.")
        }
        return url
    }

    // MARK: Notifications (APNs)
    var pushToken: String? {
        get { Keychain.get("pushToken") }
        set { Keychain.set("pushToken", newValue) }
    }
    // Registers this phone's APNs token with the topics the person opted in to, or removes it.
    func setPush(topics: [String]) async throws {
        guard let token = pushToken else {
            throw ApiError(status: 409, message: "Notifications are not available yet. Allow them when asked, then try again.")
        }
        if topics.isEmpty { try await Api.raw("DELETE", "/me/push-token", ["token": token]) }
        else { try await Api.raw("PUT", "/me/push-token", ["platform": "apns", "token": token, "topics": topics]) }
        pushTopics = topics
        Keychain.set("pushTopics", topics.joined(separator: ","))
    }

    // MARK: Gate
    private func saveQueue(_ q: [QueuedScan]) {
        queue = q
        Files.save("queue.json", q)
    }
    private func history() -> [Seen] { Files.load("history.json") ?? [] }
    private func remember(_ tokenId: String, _ zoneId: Int, _ at: String) {
        Files.save("history.json", history() + [Seen(tokenId: tokenId, zoneId: zoneId, scannedAt: at)])
    }

    func enrol(_ ctx: GateContext, _ gate: Gate) async throws {
        let version = Foundation.Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let out: EnrolOut = try await Api.post("/gate/devices", ["gateId": gate.id, "name": "\(gate.name) \(UIDevice.current.model)", "platform": "ios", "appVersion": version])
        let d = Device(deviceId: out.deviceId, key: out.key, gateId: gate.id, eventId: ctx.event.id)
        device = d
        if let data = try? JSONEncoder().encode(d) { Keychain.set("device", String(data: data, encoding: .utf8)) }
        try await loadBundle()
    }

    // Fetches the signed eligibility set and rejects it unless the signature matches this
    // device's key.
    func loadBundle() async throws {
        guard let d = device else { return }
        let env: BundleEnvelope = try await Api.get("/gate/devices/\(d.deviceId)/bundle")
        let mac = HMAC<SHA256>.authenticationCode(for: Data(env.payload.utf8), using: SymmetricKey(data: Data(d.key.utf8)))
        guard mac.map({ String(format: "%02x", $0) }).joined() == env.signature else {
            throw ApiError(status: 500, message: "The eligibility data failed its signature check and was not saved.")
        }
        var parsed: Eligibility = try Api.decode(Data(env.payload.utf8))
        parsed.loadedAt = ScanRules.nowIso()
        bundle = parsed
        Files.save("bundle.json", parsed)
        Files.save("history.json", parsed.seen)
    }

    // The server removed this device: clear its cached data, as the privacy rules require.
    private func handleRevoked(_ e: ApiError) -> Bool {
        guard e.code == "device_revoked" else { return false }
        leaveGate()
        return true
    }
    func leaveGate() {
        device = nil; bundle = nil
        Keychain.set("device", nil)
        ["bundle.json", "queue.json", "history.json"].forEach(Files.delete)
        queue = []
    }

    // One scan: validated online when possible, otherwise decided from the preloaded set and
    // queued with a stable id for upload.
    func scan(_ gate: Gate, text: String, passId: Int? = nil) async throws -> ScanResult {
        guard let d = device else { throw ApiError(status: 409, message: "This device is not enrolled for a gate") }
        let id = ScanRules.newScanId()
        let at = ScanRules.nowIso()
        let tokenId = ScanRules.tokenOf(text)
        do {
            let body: [String: Any?] = passId != nil
                ? ["gateId": gate.id, "deviceId": d.deviceId, "id": id, "passId": passId]
                : ["gateId": gate.id, "deviceId": d.deviceId, "id": id, "qr": text, "scannedAt": at, "queuedCount": queue.count]
            let out: ScanResult = try await Api.post("/gate/scans", body)
            online = true
            if let tokenId = tokenId, ScanRules.isAdmit(out.result) { remember(tokenId, gate.zoneId, at) }
            return out
        } catch let e as ApiError {
            if handleRevoked(e) {
                throw ApiError(status: 410, message: "This device was removed from the event. Its saved data has been cleared.", code: "device_revoked")
            }
            if !e.offline || passId != nil { throw e }
            online = false
            let local = ScanRules.decideOffline(bundle: bundle, gate: gate, history: history(), tokenId: tokenId, scannedAt: at)
            if let tokenId = tokenId, ScanRules.isAdmit(local.result) { remember(tokenId, gate.zoneId, at) }
            saveQueue(queue + [QueuedScan(id: id, gateId: gate.id, qr: text, scannedAt: at, deviceResult: local.result)])
            return local
        }
    }

    // Uploads queued scans and refreshes the eligibility set. Returns the number of scans
    // another device had also admitted, or nil when the server could not be reached.
    @discardableResult
    func sync() async -> Int? {
        guard let d = device else { return 0 }
        if syncing { return nil }
        syncing = true
        defer { syncing = false }
        do {
            let pending = queue
            var conflicts = 0
            if !pending.isEmpty {
                let scans: [[String: Any]] = pending.map { ["id": $0.id, "gateId": $0.gateId, "qr": $0.qr, "scannedAt": $0.scannedAt, "deviceResult": $0.deviceResult] }
                let out: SyncOut = try await Api.post("/gate/scans/sync", ["deviceId": d.deviceId, "queuedCount": 0, "scans": scans])
                conflicts = out.conflicts
                let sent = Set(pending.map { $0.id })
                saveQueue(queue.filter { !sent.contains($0.id) })
            } else {
                try await Api.raw("POST", "/gate/devices/\(d.deviceId)/heartbeat", ["queuedCount": 0])
            }
            try await loadBundle()
            online = true
            return conflicts
        } catch let e as ApiError {
            if handleRevoked(e) { return nil }
            if e.offline { online = false }
            return nil
        } catch {
            return nil
        }
    }
}
