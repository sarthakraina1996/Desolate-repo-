// JSON shapes of the BrainADZ Events API (/api/v1). The Android app declares the same shapes
// in Models.kt.
import Foundation

struct User: Codable { let id: Int; let email: String; let name: String? }
struct SessionOut: Codable { let token: String?; let user: User? }
struct CodeOut: Codable { let demoCode: String? }

struct GateRole: Codable { let eventId: Int; let name: String?; let role: String; let gateId: Int? }
struct ExhibitorRole: Codable, Identifiable {
    let exhibitorId: Int, companyName: String, status: String, role: String
    let eventId: Int, slug: String, eventName: String, perms: [String]
    var id: Int { exhibitorId }
}
struct Me: Codable {
    var user: User?
    var gate: [GateRole]?
    var exhibitor: [ExhibitorRole]?
}

// MARK: Published event guide
struct EventInfo: Codable {
    let id: Int, slug: String, name: String
    let edition: String?, tagline: String?, description: String?
    let venueName: String?, venueAddress: String?, city: String?
    let timezone: String, startsOn: String, endsOn: String, openTime: String, closeTime: String
}
struct Faq: Codable, Hashable { let q: String; let a: String }
struct PassClass: Codable, Identifiable {
    let code: String, name: String, kind: String, mode: String
    let description: String?
    let totalPaise: Int, priceLabel: String, soldOut: Bool
    var id: String { code }
}
struct FormField: Codable, Identifiable {
    let key: String, label: String, type: String, options: [String], required: Bool
    var id: String { key }
}
struct Announcement: Codable, Identifiable { let id: Int; let kind: String; let title: String; let body: String }
struct WebLink: Codable, Hashable { let label: String; let url: String }
struct Exhibitor: Codable, Identifiable {
    let id: Int, name: String
    let industry: String?, description: String?, website: String?
    let catalogueLinks: [WebLink], categories: [String]
    let boothCode: String?, boothId: Int?, hall: String?
}
struct Booth: Codable, Identifiable {
    let id: Int, code: String, x: Double, y: Double, w: Double, h: Double
    let exhibitorId: Int?, exhibitor: String?
}
struct MapGate: Codable, Identifiable { let id: Int; let name: String; let x: Double?; let y: Double? }
struct Amenity: Codable, Identifiable { let id: Int; let kind: String; let label: String; let x: Double; let y: Double; let accessible: Bool }
struct Hall: Codable, Identifiable {
    let id: Int, code: String, name: String, cols: Int, rows: Int
    let booths: [Booth], gates: [MapGate], amenities: [Amenity]
}
struct Track: Codable, Identifiable { let id: Int; let name: String }
struct Speaker: Codable, Hashable { let name: String; let title: String? }
struct AgendaSession: Codable, Identifiable {
    let id: Int, title: String
    let description: String?
    let speakers: [Speaker]
    let day: String, startTime: String, endTime: String
    let trackId: Int?, track: String?, room: String?
    let full: Bool, status: String
}
struct Agenda: Codable { let tracks: [Track]; let sessions: [AgendaSession] }
struct Guide: Codable {
    let version: Int
    let event: EventInfo
    let accessibility: String?
    let faqs: [Faq], passClasses: [PassClass], formFields: [FormField]
    let leadSharingNotice: String
    let announcements: [Announcement], exhibitors: [Exhibitor], halls: [Hall]
    let agenda: Agenda
    // Set on the device when the copy was saved, to show "last updated" while offline.
    var savedAt: String?
}
// The short answer the server gives when the cached guide is still current.
struct GuideCheck: Codable { let version: Int; let unchanged: Bool? }

// MARK: Registrations and passes
struct ClassRef: Codable { let code: String; let name: String; let kind: String; let mode: String? }
struct PassEvent: Codable {
    let slug: String, name: String
    let venueName: String?
    let startsOn: String, endsOn: String, openTime: String, closeTime: String
}
struct Pass: Codable, Identifiable {
    let id: Int
    let ref: String?, qr: String?
    let status: String, holderName: String
    let holderCompany: String?
    let passClass: ClassRef
    let validFrom: String, validTo: String
    let zones: [String], gates: [String]
    let instructions: String
    let firstAdmittedAt: String?
    let event: PassEvent
}
struct OrderItem: Codable, Hashable { let description: String; let qty: Int; let amountPaise: Int }
struct Order: Codable, Identifiable {
    let id: Int, number: String, kind: String, status: String
    let items: [OrderItem]
    let gstPaise: Int, totalPaise: Int, paidPaise: Int, balancePaise: Int
    let token: String?
}
struct EventRef: Codable { let slug: String; let name: String }
struct Registration: Codable, Identifiable {
    let id: Int, ref: String, name: String, email: String, status: String, paymentStatus: String, step: String
    let reviewNote: String?
    let passClass: ClassRef
    let pass: Pass?
    let order: Order?
    let event: EventRef
}
struct MyPasses: Codable {
    var registrations: [Registration] = []
    var badges: [Pass] = []
    var syncedAt: String = ""
}
struct RegisterOut: Codable { let ref: String; let email: String; var demoCode: String? }
struct VerifyOut: Codable { let token: String?; let accessToken: String; let registration: Registration }
struct CheckoutOut: Codable { let url: String }

// MARK: Exhibitor workspace
struct ExhibitorInfo: Codable { let id: Int; let companyName: String; let status: String; let reviewNote: String? }
struct BoothInfo: Codable { let code: String; let hall: String; let status: String }
struct NextStep: Codable { let key: String; let text: String }
struct ChecklistItem: Codable, Identifiable {
    let id: Int, key: String, title: String
    let dueOn: String?
    let status: String
    let note: String?
    let overdue: Bool
}
struct Totals: Codable { let totalPaise: Int; let paidPaise: Int; let balancePaise: Int }
struct TeamMember: Codable, Identifiable { let id: Int; let name: String; let email: String; let role: String; let status: String }
struct Lead: Codable, Identifiable {
    let id: Int
    let name: String?, company: String?, jobTitle: String?, email: String?, rating: String?
    let tags: [String]
    let notes: String?
    let scanCount: Int
}
struct LeadScanOut: Codable { let lead: Lead; let duplicate: Bool }
struct Workspace: Codable {
    let role: String
    let exhibitor: ExhibitorInfo
    let booth: BoothInfo?
    let next: NextStep
    let checklist: [ChecklistItem], orders: [Order]
    let totals: Totals
    let team: [TeamMember]
    let badgeQuota: Int, leadCount: Int
    let interestTags: [String]
    let event: EventRef
}

// MARK: Gate
struct Gate: Codable, Identifiable { let id: Int; let code: String; let name: String; let zoneId: Int; let zoneName: String; let restricted: Bool }
struct GateContext: Codable, Identifiable {
    let event: EventInfo
    let canOverride: Bool, canReprint: Bool, canPrint: Bool
    let gates: [Gate]
    var id: Int { event.id }
}
struct EnrolOut: Codable { let deviceId: Int; let key: String; let gateId: Int }
struct BundleEnvelope: Codable { let payload: String; let signature: String }
struct BundleZone: Codable { let id: Int; let restricted: Int }
struct BundleClass: Codable {
    let id: Int, name: String, zoneIds: [Int], validFrom: String, validTo: String, reentry: Bool
}
struct Seen: Codable { let tokenId: String; let zoneId: Int; let scannedAt: String }
// One pass in the eligibility set, sent as [pass class id, holder name, revoked 0/1].
struct BundlePass: Codable {
    let classId: Int, name: String, revoked: Int
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        classId = try c.decode(Int.self)
        name = try c.decode(String.self)
        revoked = try c.decode(Int.self)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(classId)
        try c.encode(name)
        try c.encode(revoked)
    }
}
struct Eligibility: Codable {
    let eventId: Int, timezone: String, expiresAt: String, repeatWindowSeconds: Int
    let zones: [BundleZone], classes: [BundleClass]
    let passes: [String: BundlePass]
    let seen: [Seen]
    var loadedAt: String?
}
struct Earlier: Codable { let at: String; let gate: String }
struct ScanResult: Codable {
    var id: String?
    let result: String
    var conflict: Bool?
    var passId: Int?
    var name: String?, company: String?, passClass: String?
    var earlier: Earlier?
    // Set on the device for scans decided without a connection.
    var offline: Bool?
    var bundleExpired: Bool?
}
struct QueuedScan: Codable { let id: String; let gateId: Int; let qr: String; let scannedAt: String; let deviceResult: String }
struct SyncOut: Codable { let conflicts: Int }
struct LookupRow: Codable, Identifiable {
    let passId: Int, name: String
    let company: String?
    let passClass: String, status: String
    let ref: String?, email: String?, admittedAt: String?
    var id: Int { passId }
}
struct PrintJob: Codable { let id: Int; let status: String; let error: String?; let printer: String? }
struct Device: Codable { let deviceId: Int; let key: String; let gateId: Int; let eventId: Int }
