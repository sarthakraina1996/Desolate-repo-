// JSON shapes of the BrainADZ Events API (/api/v1). The iOS app declares the same shapes
// in Models.swift.
package com.brainadz.events.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray

@Serializable data class User(val id: Int, val email: String, val name: String = "")
@Serializable data class SessionOut(val token: String? = null, val user: User? = null)
@Serializable data class CodeOut(val ok: Boolean = true, val demoCode: String? = null)

@Serializable data class GateRole(val eventId: Int, val name: String? = null, val role: String, val gateId: Int? = null)
@Serializable data class ExhibitorRole(
    val exhibitorId: Int, val companyName: String, val status: String, val role: String,
    val eventId: Int, val slug: String, val eventName: String, val perms: List<String> = emptyList(),
)
@Serializable data class Me(
    val user: User? = null,
    val gate: List<GateRole> = emptyList(),
    val exhibitor: List<ExhibitorRole> = emptyList(),
    val registrations: Int = 0,
)

// ---------- published event guide ----------
@Serializable data class EventInfo(
    val id: Int = 0, val slug: String, val name: String, val edition: String = "", val tagline: String? = null,
    val description: String? = null, val venueName: String? = null, val venueAddress: String? = null,
    val city: String? = null, val timezone: String = "Asia/Kolkata", val startsOn: String = "", val endsOn: String = "",
    val openTime: String = "", val closeTime: String = "",
    // Background photo of the sign-in screen, set per exhibition by the organiser.
    val loginImage: String? = null,
)
@Serializable data class Faq(val q: String, val a: String)
@Serializable data class PassClass(
    val code: String, val name: String, val kind: String = "", val mode: String = "free",
    val description: String? = null, val totalPaise: Long = 0, val priceLabel: String = "", val soldOut: Boolean = false,
)
@Serializable data class FormField(
    val key: String, val label: String, val type: String, val options: List<String> = emptyList(), val required: Boolean = false,
)
@Serializable data class Announcement(val id: Int, val kind: String, val title: String, val body: String, val publishedAt: String = "")
@Serializable data class Link(val label: String, val url: String)
@Serializable data class Exhibitor(
    val id: Int, val name: String, val industry: String? = null, val description: String? = null, val website: String? = null,
    val catalogueLinks: List<Link> = emptyList(), val categories: List<String> = emptyList(),
    val boothCode: String? = null, val boothId: Int? = null, val hall: String? = null,
)
@Serializable data class Booth(
    val id: Int, val code: String, val x: Double, val y: Double, val w: Double, val h: Double,
    val exhibitorId: Int? = null, val exhibitor: String? = null, val categories: List<String> = emptyList(),
)
@Serializable data class MapGate(val id: Int, val name: String, val x: Double? = null, val y: Double? = null)
@Serializable data class Amenity(val id: Int, val kind: String, val label: String, val x: Double, val y: Double, val accessible: Boolean = false)
@Serializable data class Hall(
    val id: Int, val code: String, val name: String, val cols: Int = 0, val rows: Int = 0,
    val booths: List<Booth> = emptyList(), val gates: List<MapGate> = emptyList(), val amenities: List<Amenity> = emptyList(),
)
@Serializable data class Track(val id: Int, val name: String)
@Serializable data class Speaker(val name: String, val title: String? = null)
@Serializable data class AgendaSession(
    val id: Int, val title: String, val description: String? = null, val speakers: List<Speaker> = emptyList(),
    val day: String, val startTime: String, val endTime: String, val trackId: Int? = null, val track: String? = null,
    val room: String? = null, val full: Boolean = false, val status: String = "scheduled",
)
@Serializable data class Agenda(val tracks: List<Track> = emptyList(), val sessions: List<AgendaSession> = emptyList())
@Serializable data class Guide(
    val version: Int = 0, val unchanged: Boolean = false, val event: EventInfo? = null, val accessibility: String? = null,
    val faqs: List<Faq> = emptyList(), val passClasses: List<PassClass> = emptyList(), val formFields: List<FormField> = emptyList(),
    val leadSharingNotice: String = "", val announcements: List<Announcement> = emptyList(),
    val exhibitors: List<Exhibitor> = emptyList(), val halls: List<Hall> = emptyList(), val agenda: Agenda = Agenda(),
    // Set on the device when the copy was saved, to show "last updated" while offline.
    val savedAt: String = "",
)

// ---------- registrations and passes ----------
@Serializable data class ClassRef(val code: String = "", val name: String, val kind: String = "", val mode: String = "")
@Serializable data class PassEvent(
    val slug: String, val name: String, val venueName: String? = null, val startsOn: String = "", val endsOn: String = "",
    val openTime: String = "", val closeTime: String = "",
)
@Serializable data class Pass(
    val id: Int, val ref: String? = null, val qr: String? = null, val status: String = "active", val holderName: String,
    val holderCompany: String? = null, val passClass: ClassRef, val validFrom: String = "", val validTo: String = "",
    val zones: List<String> = emptyList(), val gates: List<String> = emptyList(), val instructions: String = "",
    val firstAdmittedAt: String? = null, val event: PassEvent,
)
@Serializable data class OrderItem(val description: String, val qty: Int = 1, val amountPaise: Long = 0)
@Serializable data class Order(
    val id: Int, val number: String, val kind: String = "", val status: String = "", val items: List<OrderItem> = emptyList(),
    val gstPaise: Long = 0, val totalPaise: Long = 0, val paidPaise: Long = 0, val balancePaise: Long = 0, val token: String? = null,
)
@Serializable data class EventRef(val slug: String = "", val name: String = "")
@Serializable data class Registration(
    val id: Int, val ref: String, val name: String, val email: String, val status: String, val paymentStatus: String,
    val step: String, val reviewNote: String? = null, val passClass: ClassRef, val pass: Pass? = null, val order: Order? = null,
    val event: EventRef = EventRef(),
)
@Serializable data class MyPasses(
    val registrations: List<Registration> = emptyList(), val badges: List<Pass> = emptyList(), val syncedAt: String = "",
)
@Serializable data class RegisterOut(val ref: String, val email: String, val demoCode: String? = null)
@Serializable data class VerifyOut(val token: String? = null, val accessToken: String, val registration: Registration)
@Serializable data class CheckoutOut(val url: String)

// ---------- exhibitor workspace ----------
@Serializable data class ExhibitorInfo(val id: Int, val companyName: String, val status: String, val reviewNote: String? = null)
@Serializable data class BoothInfo(val code: String, val hall: String, val status: String, val sizeSqm: Int = 0)
@Serializable data class NextStep(val key: String, val text: String)
@Serializable data class ChecklistItem(
    val id: Int, val key: String, val title: String, val dueOn: String? = null, val status: String,
    val note: String? = null, val overdue: Boolean = false,
)
@Serializable data class Totals(val totalPaise: Long = 0, val paidPaise: Long = 0, val balancePaise: Long = 0)
@Serializable data class TeamMember(val id: Int, val name: String, val email: String, val role: String, val status: String)
@Serializable data class Lead(
    val id: Int, val name: String? = null, val company: String? = null, val jobTitle: String? = null, val email: String? = null,
    val rating: String? = null, val tags: List<String> = emptyList(), val notes: String? = null, val scanCount: Int = 1,
    val lastScannedAt: String = "",
)
@Serializable data class LeadScanOut(val lead: Lead, val duplicate: Boolean)
@Serializable data class Workspace(
    val role: String, val exhibitor: ExhibitorInfo, val booth: BoothInfo? = null, val next: NextStep,
    val checklist: List<ChecklistItem> = emptyList(), val orders: List<Order> = emptyList(), val totals: Totals = Totals(),
    val team: List<TeamMember> = emptyList(), val badgeQuota: Int = 0, val leadCount: Int = 0,
    val recentLeads: List<Lead> = emptyList(), val interestTags: List<String> = emptyList(), val event: EventRef = EventRef(),
)

// ---------- gate ----------
@Serializable data class Gate(val id: Int, val code: String, val name: String, val zoneId: Int, val zoneName: String, val restricted: Boolean = false)
@Serializable data class GateContext(
    val event: EventInfo, val canOverride: Boolean = false, val canReprint: Boolean = false, val canPrint: Boolean = false,
    val gates: List<Gate> = emptyList(),
)
@Serializable data class EnrolOut(val deviceId: Int, val key: String, val gateId: Int)
@Serializable data class BundleEnvelope(val payload: String, val signature: String)
@Serializable data class BundleZone(val id: Int, val restricted: Int = 0)
@Serializable data class BundleClass(
    val id: Int, val name: String, val zoneIds: List<Int>, val validFrom: String, val validTo: String, val reentry: Boolean,
)
@Serializable data class Seen(val tokenId: String, val zoneId: Int, val scannedAt: String)
// passes maps an opaque token id to [pass class id, holder name, revoked 0/1].
@Serializable data class Bundle(
    val eventId: Int, val timezone: String, val expiresAt: String, val repeatWindowSeconds: Int = 90,
    val zones: List<BundleZone> = emptyList(), val classes: List<BundleClass> = emptyList(),
    val passes: Map<String, JsonArray> = emptyMap(), val seen: List<Seen> = emptyList(), val loadedAt: String = "",
)
@Serializable data class Earlier(val at: String, val gate: String)
@Serializable data class ScanResult(
    val id: String = "", val result: String, val conflict: Boolean = false, val passId: Int? = null, val name: String? = null,
    val company: String? = null, val passClass: String? = null, val earlier: Earlier? = null,
    // Set on the device for scans decided without a connection.
    val offline: Boolean = false, val bundleExpired: Boolean = false,
)
@Serializable data class QueuedScan(val id: String, val gateId: Int, val qr: String, val scannedAt: String, val deviceResult: String)
@Serializable data class SyncOut(val results: List<ScanResult> = emptyList(), val conflicts: Int = 0)
@Serializable data class LookupRow(
    val passId: Int, val name: String, val company: String? = null, val passClass: String, val status: String,
    val ref: String? = null, val email: String? = null, val admittedAt: String? = null,
)
@Serializable data class PrintJob(val id: Int, val status: String, val error: String? = null, val printer: String? = null, val kind: String = "first")
@Serializable data class Device(val deviceId: Int, val key: String, val gateId: Int, val eventId: Int)
