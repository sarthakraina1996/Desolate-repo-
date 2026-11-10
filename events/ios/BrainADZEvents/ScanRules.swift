// Gate scan rules for a device without a connection. A line-for-line mirror of
// shared/scanRules.js on the server and ScanRules.kt on Android: the three must agree.
import Foundation

enum Tone { case ok, warn, deny }
struct ResultInfo { let tone: Tone; let title: String; let hint: String }

enum ScanRules {
    // Every result a scan can have, with how staff should read it.
    static let results: [String: ResultInfo] = [
        "admitted": ResultInfo(tone: .ok, title: "Pass accepted", hint: "First entry today."),
        "reentry": ResultInfo(tone: .ok, title: "Re-entry accepted", hint: "This pass allows re-entry."),
        "override_admitted": ResultInfo(tone: .ok, title: "Admitted by override", hint: "Reason recorded."),
        "exit": ResultInfo(tone: .ok, title: "Exit recorded", hint: ""),
        "repeat": ResultInfo(tone: .warn, title: "Already scanned", hint: "This pass was scanned moments ago. Do not admit a second person on it."),
        "needs_online": ResultInfo(tone: .warn, title: "Needs an online check", hint: "This area cannot be checked offline. Reconnect or send to the help desk."),
        "denied_reentry": ResultInfo(tone: .deny, title: "Already used", hint: "This pass has been used and does not allow re-entry."),
        "denied_wrong_zone": ResultInfo(tone: .deny, title: "Wrong area", hint: "This pass is not valid for this gate."),
        "denied_expired": ResultInfo(tone: .deny, title: "Pass expired", hint: "This pass was for an earlier day."),
        "denied_not_yet_valid": ResultInfo(tone: .deny, title: "Not valid yet", hint: "This pass starts on a later day."),
        "denied_revoked": ResultInfo(tone: .deny, title: "Pass cancelled", hint: "This pass was cancelled or refunded."),
        "denied_unknown": ResultInfo(tone: .deny, title: "Pass not recognised", hint: "This is not a pass for this event, or it was issued after the last sync."),
    ]
    static func info(_ result: String) -> ResultInfo { results[result] ?? ResultInfo(tone: .deny, title: result, hint: "") }
    static func isAdmit(_ result: String) -> Bool { result == "admitted" || result == "reentry" || result == "override_admitted" }

    // The opaque token id inside a pass QR, or nil when the text is not a pass.
    static func tokenOf(_ text: String) -> String? {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "BAE1" else { return nil }
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        let ok: (Substring, ClosedRange<Int>) -> Bool = { s, range in
            range.contains(s.count) && s.unicodeScalars.allSatisfy { allowed.contains($0) }
        }
        return ok(parts[1], 16...40) && ok(parts[2], 16...64) ? String(parts[1]) : nil
    }

    static func date(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso) ?? .distantPast
    }
    static func nowIso() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
    // The calendar date (yyyy-MM-dd) of an instant in the event's timezone.
    static func eventDay(_ timezone: String, _ iso: String) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: timezone) ?? TimeZone(identifier: "Asia/Kolkata")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date(iso))
    }

    static func decide(
        active: Bool, cls: BundleClass?, zoneId: Int, restricted: Bool, day: String, scannedAt: String,
        prior: [String], repeatWindowSeconds: Int, online: Bool
    ) -> String {
        guard let cls = cls else { return "denied_unknown" }
        if !active { return "denied_revoked" }
        if day < cls.validFrom { return "denied_not_yet_valid" }
        if day > cls.validTo { return "denied_expired" }
        if !cls.zoneIds.contains(zoneId) { return "denied_wrong_zone" }
        if restricted && !online { return "needs_online" }
        guard let last = prior.last else { return "admitted" }
        let seconds = date(scannedAt).timeIntervalSince(date(last))
        if seconds < Double(repeatWindowSeconds) { return "repeat" }
        return cls.reentry ? "reentry" : "denied_reentry"
    }

    // Decides a scan from the preloaded eligibility set and this device's own scan history.
    static func decideOffline(bundle: Eligibility?, gate: Gate, history: [Seen], tokenId: String?, scannedAt: String) -> ScanResult {
        guard let bundle = bundle, date(bundle.expiresAt) >= date(scannedAt) else {
            return ScanResult(result: "needs_online", offline: true, bundleExpired: true)
        }
        guard let tokenId = tokenId, let entry = bundle.passes[tokenId] else {
            return ScanResult(result: "denied_unknown", offline: true)
        }
        let cls = bundle.classes.first { $0.id == entry.classId }
        let day = eventDay(bundle.timezone, scannedAt)
        let at = date(scannedAt)
        let prior = history
            .filter { $0.tokenId == tokenId && $0.zoneId == gate.zoneId && eventDay(bundle.timezone, $0.scannedAt) == day && date($0.scannedAt) <= at }
            .sorted { date($0.scannedAt) < date($1.scannedAt) }
            .map { $0.scannedAt }
        let result = decide(
            active: entry.revoked == 0, cls: cls, zoneId: gate.zoneId,
            restricted: (bundle.zones.first { $0.id == gate.zoneId }?.restricted ?? 0) != 0,
            day: day, scannedAt: scannedAt, prior: prior, repeatWindowSeconds: bundle.repeatWindowSeconds, online: false
        )
        return ScanResult(result: result, name: entry.name, passClass: cls?.name, offline: true)
    }

    // A stable id made on the device, so a retried upload never creates a second scan.
    static func newScanId() -> String { UUID().uuidString.lowercased() }
}
