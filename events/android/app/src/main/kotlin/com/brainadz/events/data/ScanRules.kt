// Gate scan rules for a device without a connection. A line-for-line mirror of
// shared/scanRules.js on the server and ScanRules.swift on iOS: the three must agree.
package com.brainadz.events.data

import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

enum class Tone { OK, WARN, DENY }
data class ResultInfo(val tone: Tone, val title: String, val hint: String)

object ScanRules {
    // Every result a scan can have, with how staff should read it.
    val RESULTS = mapOf(
        "admitted" to ResultInfo(Tone.OK, "Pass accepted", "First entry today."),
        "reentry" to ResultInfo(Tone.OK, "Re-entry accepted", "This pass allows re-entry."),
        "override_admitted" to ResultInfo(Tone.OK, "Admitted by override", "Reason recorded."),
        "exit" to ResultInfo(Tone.OK, "Exit recorded", ""),
        "repeat" to ResultInfo(Tone.WARN, "Already scanned", "This pass was scanned moments ago. Do not admit a second person on it."),
        "needs_online" to ResultInfo(Tone.WARN, "Needs an online check", "This area cannot be checked offline. Reconnect or send to the help desk."),
        "denied_reentry" to ResultInfo(Tone.DENY, "Already used", "This pass has been used and does not allow re-entry."),
        "denied_wrong_zone" to ResultInfo(Tone.DENY, "Wrong area", "This pass is not valid for this gate."),
        "denied_expired" to ResultInfo(Tone.DENY, "Pass expired", "This pass was for an earlier day."),
        "denied_not_yet_valid" to ResultInfo(Tone.DENY, "Not valid yet", "This pass starts on a later day."),
        "denied_revoked" to ResultInfo(Tone.DENY, "Pass cancelled", "This pass was cancelled or refunded."),
        "denied_unknown" to ResultInfo(Tone.DENY, "Pass not recognised", "This is not a pass for this event, or it was issued after the last sync."),
    )
    fun info(result: String) = RESULTS[result] ?: ResultInfo(Tone.DENY, result, "")
    fun isAdmit(result: String) = result == "admitted" || result == "reentry" || result == "override_admitted"

    private val QR = Regex("^BAE1\\.([A-Za-z0-9_-]{16,40})\\.([A-Za-z0-9_-]{16,64})$")
    // The opaque token id inside a pass QR, or null when the text is not a pass.
    fun tokenOf(text: String): String? = QR.find(text.trim())?.groupValues?.get(1)

    // The calendar date of an instant in the event's timezone.
    fun eventDay(timezone: String, iso: String): String =
        Instant.parse(iso).atZone(ZoneId.of(timezone)).toLocalDate().toString()

    fun decide(
        active: Boolean, cls: BundleClass?, zoneId: Int, restricted: Boolean, day: String, scannedAt: String,
        prior: List<String>, repeatWindowSeconds: Int, online: Boolean,
    ): String {
        if (cls == null) return "denied_unknown"
        if (!active) return "denied_revoked"
        if (day < cls.validFrom) return "denied_not_yet_valid"
        if (day > cls.validTo) return "denied_expired"
        if (zoneId !in cls.zoneIds) return "denied_wrong_zone"
        if (restricted && !online) return "needs_online"
        if (prior.isEmpty()) return "admitted"
        val seconds = (Instant.parse(scannedAt).toEpochMilli() - Instant.parse(prior.last()).toEpochMilli()) / 1000
        if (seconds < repeatWindowSeconds) return "repeat"
        return if (cls.reentry) "reentry" else "denied_reentry"
    }

    // Decides a scan from the preloaded eligibility set and this device's own scan history.
    fun decideOffline(bundle: Bundle?, gate: Gate, history: List<Seen>, tokenId: String?, scannedAt: String): ScanResult {
        if (bundle == null || Instant.parse(bundle.expiresAt).isBefore(Instant.parse(scannedAt)))
            return ScanResult(result = "needs_online", offline = true, bundleExpired = true)
        val entry = tokenId?.let { bundle.passes[it] } ?: return ScanResult(result = "denied_unknown", offline = true)
        val cls = bundle.classes.find { it.id == entry[0].jsonPrimitive.int }
        val day = eventDay(bundle.timezone, scannedAt)
        val at = Instant.parse(scannedAt)
        val prior = history
            .filter { it.tokenId == tokenId && it.zoneId == gate.zoneId && eventDay(bundle.timezone, it.scannedAt) == day && !Instant.parse(it.scannedAt).isAfter(at) }
            .sortedBy { Instant.parse(it.scannedAt) }
            .map { it.scannedAt }
        val result = decide(
            active = entry[2].jsonPrimitive.int == 0, cls = cls, zoneId = gate.zoneId,
            restricted = (bundle.zones.find { it.id == gate.zoneId }?.restricted ?: 0) != 0,
            day = day, scannedAt = scannedAt, prior = prior, repeatWindowSeconds = bundle.repeatWindowSeconds, online = false,
        )
        return ScanResult(result = result, name = entry[1].jsonPrimitive.content, passClass = cls?.name, offline = true)
    }

    // A stable id made on the device, so a retried upload never creates a second scan.
    fun newScanId(): String = UUID.randomUUID().toString()
}
