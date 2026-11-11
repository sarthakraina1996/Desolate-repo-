// App state and the operations the screens call. Passes, the event guide and the gate scan
// queue are cached on the device so the app keeps working without a connection; everything
// is cleared on sign-out or when the server revokes this device.
package com.brainadz.events.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.brainadz.events.BuildConfig
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.encodeToString

fun nowIso(): String = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()

object Repo {
    private lateinit var secure: SecureStore
    private lateinit var files: FileStore
    private lateinit var appContext: Context

    var ready by mutableStateOf(false)
    var me by mutableStateOf(Me())
    var passes by mutableStateOf(MyPasses())
    // A registration opened from a pass link, for visitors who have not signed in.
    var linked by mutableStateOf<Registration?>(null)
    var guide by mutableStateOf<Guide?>(null)
    var bookmarks by mutableStateOf(setOf<Int>())

    var device by mutableStateOf<Device?>(null)
    var bundle by mutableStateOf<Bundle?>(null)
    var queue by mutableStateOf(listOf<QueuedScan>())
    var online by mutableStateOf(true)
    var syncing by mutableStateOf(false)

    val signedIn get() = me.user != null
    val slug get() = guide?.event?.slug

    fun init(context: Context) {
        appContext = context.applicationContext
        secure = SecureStore(appContext)
        files = FileStore(appContext)
        Api.baseUrl = secure.get("server") ?: BuildConfig.API_BASE_URL
        Api.token = secure.get("token")
        // Show cached data at once; the network refresh follows in start().
        passes = load("passes.json") ?: MyPasses()
        linked = load("linked.json")
        guide = load("guide.json")
        device = secure.get("device")?.let { runCatching { json.decodeFromString<Device>(it) }.getOrNull() }
        bundle = load("bundle.json")
        queue = load("queue.json") ?: emptyList()
    }

    private inline fun <reified T> load(name: String): T? =
        files.read(name)?.let { runCatching { json.decodeFromString<T>(it) }.getOrNull() }
    private inline fun <reified T> save(name: String, value: T) = files.write(name, json.encodeToString(value))

    var serverUrl: String
        get() = Api.baseUrl
        set(value) {
            Api.baseUrl = value.trim().trimEnd('/')
            secure.put("server", Api.baseUrl)
        }

    // Called at launch and on resume: refresh what the server knows, quietly, if reachable.
    suspend fun start() {
        try {
            if (Api.token != null) refreshMe()
            if (signedIn) {
                refreshPasses()
                bookmarks = Api.get<List<Int>>("/me/bookmarks").toSet()
            }
            secure.get("passLink")?.let { runCatching { openPassLink(it) } }
            val known = slug ?: passes.registrations.firstOrNull()?.event?.slug ?: Api.get<List<EventInfo>>("/public/events").firstOrNull()?.slug
            known?.let { loadGuide(it) }
            online = true
        } catch (e: ApiException) {
            if (e.offline) online = false
            if (e.status == 401) localSignOut()
        }
        ready = true
        if (device != null) sync()
    }

    // ---------- session ----------
    suspend fun refreshMe() {
        me = Api.get("/me")
    }
    private suspend fun signedInWith(out: SessionOut) {
        Api.token = out.token
        secure.put("token", out.token)
        refreshMe()
        refreshPasses()
        bookmarks = Api.get<List<Int>>("/me/bookmarks").toSet()
    }
    suspend fun signIn(email: String, password: String) =
        signedInWith(Api.post("/auth/login", body("email" to email, "password" to password, "client" to "android")))
    suspend fun requestCode(email: String): CodeOut = Api.post("/auth/code", body("email" to email))
    suspend fun verifyCode(email: String, code: String) =
        signedInWith(Api.post("/auth/code/verify", body("email" to email, "code" to code, "client" to "android")))

    // Signs out and purges everything cached on this device.
    suspend fun signOut() {
        runCatching { Api.raw("POST", "/auth/logout") }
        localSignOut()
    }
    private fun localSignOut() {
        val server = Api.baseUrl
        Api.token = null
        secure.clear()
        secure.put("server", server)
        files.clear()
        me = Me(); passes = MyPasses(); linked = null; bookmarks = emptySet()
        device = null; bundle = null; queue = emptyList()
    }

    // ---------- visitor ----------
    suspend fun refreshPasses() {
        passes = Api.get("/me/passes")
        save("passes.json", passes)
    }
    suspend fun events(): List<EventInfo> = Api.get("/public/events")
    // Downloads the guide only when the server has a newer version than the cached copy.
    suspend fun loadGuide(slug: String) {
        val have = guide?.takeIf { it.event?.slug == slug }?.version ?: 0
        val fresh: Guide = Api.get("/public/events/$slug/guide?have=$have")
        if (!fresh.unchanged) guide = fresh
        guide = guide?.copy(savedAt = nowIso())
        guide?.let { save("guide.json", it) }
    }
    suspend fun toggleBookmark(sessionId: Int) {
        if (sessionId in bookmarks) Api.delete("/me/bookmarks/$sessionId") else Api.raw("PUT", "/me/bookmarks/$sessionId")
        bookmarks = if (sessionId in bookmarks) bookmarks - sessionId else bookmarks + sessionId
    }
    suspend fun register(fields: Map<String, Any?>): RegisterOut =
        Api.post("/public/events/$slug/registrations", body(*fields.toList().toTypedArray(), "client" to "android"))
    suspend fun resendCode(ref: String): CodeOut = Api.post("/public/events/$slug/registrations/$ref/resend-code")
    suspend fun verifyRegistration(ref: String, code: String) {
        val out: VerifyOut = Api.post("/public/events/$slug/registrations/$ref/verify", body("code" to code, "client" to "android"))
        signedInWith(SessionOut(token = out.token))
    }
    suspend fun passLink(email: String) { Api.raw("POST", "/public/events/$slug/pass-link", body("email" to email)) }
    // Opens a pass retrieval link and keeps the pass for offline use.
    suspend fun openPassLink(token: String) {
        val reg: Registration = Api.get("/public/pass/$token")
        secure.put("passLink", token)
        linked = reg
        save("linked.json", reg)
    }
    suspend fun cancel(reg: Registration) {
        if (signedIn) Api.raw("POST", "/me/registrations/${reg.id}/cancel") else Api.raw("POST", "/public/pass/${secure.get("passLink")}/cancel")
        if (signedIn) refreshPasses() else secure.get("passLink")?.let { openPassLink(it) }
    }
    // Hosted checkout address for an unpaid registration; opened in a browser tab.
    suspend fun checkoutUrl(order: Order): String {
        val out: CheckoutOut = Api.post("/public/orders/${order.token}/checkout", body("returnPath" to "/account"))
        return if (out.url.startsWith("http")) out.url else Api.baseUrl + out.url
    }
    suspend fun setPush(token: String, topics: List<String>) {
        if (topics.isEmpty()) Api.delete("/me/push-token", body("token" to token))
        else Api.raw("PUT", "/me/push-token", body("platform" to "fcm", "token" to token, "topics" to topics))
        secure.put("pushTopics", topics.joinToString(","))
    }
    val pushTopics get() = secure.get("pushTopics")?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
    // The FCM registration token, kept so a refreshed token can be re-registered.
    var pushToken: String?
        get() = secure.get("pushToken")
        set(value) = secure.put("pushToken", value)

    // ---------- gate ----------
    private fun saveQueue(q: List<QueuedScan>) {
        queue = q
        save("queue.json", q)
    }
    private fun history(): List<Seen> = load("history.json") ?: emptyList()
    private fun remember(tokenId: String, zoneId: Int, at: String) = save("history.json", history() + Seen(tokenId, zoneId, at))

    suspend fun enrol(ctx: GateContext, gate: Gate) {
        val out: EnrolOut = Api.post(
            "/gate/devices",
            body("gateId" to gate.id, "name" to "${gate.name} ${android.os.Build.MODEL}", "platform" to "android", "appVersion" to BuildConfig.VERSION_NAME),
        )
        device = Device(out.deviceId, out.key, gate.id, ctx.event.id)
        secure.put("device", json.encodeToString(device))
        loadBundle()
    }

    // Fetches the signed eligibility set and rejects it unless the signature matches this
    // device's key.
    suspend fun loadBundle() {
        val d = device ?: return
        val env: BundleEnvelope = Api.get("/gate/devices/${d.deviceId}/bundle")
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(d.key.toByteArray(), "HmacSHA256")) }
        val expected = mac.doFinal(env.payload.toByteArray()).joinToString("") { "%02x".format(it) }
        if (expected != env.signature) throw ApiException(500, "The eligibility data failed its signature check and was not saved.")
        val parsed = json.decodeFromString<Bundle>(env.payload).copy(loadedAt = nowIso())
        bundle = parsed
        save("bundle.json", parsed)
        save("history.json", parsed.seen)
    }

    // The server removed this device: clear its cached data, as the privacy rules require.
    private fun handleRevoked(e: ApiException): Boolean {
        if (e.code != "device_revoked") return false
        leaveGate()
        return true
    }
    fun leaveGate() {
        device = null; bundle = null
        secure.put("device", null)
        listOf("bundle.json", "queue.json", "history.json").forEach { files.delete(it) }
        queue = emptyList()
    }

    // One scan: validated online when possible, otherwise decided from the preloaded set and
    // queued with a stable id for upload.
    suspend fun scan(gate: Gate, text: String, passId: Int? = null): ScanResult {
        val d = device ?: throw ApiException(409, "This device is not enrolled for a gate")
        val id = ScanRules.newScanId()
        val at = nowIso()
        val tokenId = ScanRules.tokenOf(text)
        try {
            val payload = if (passId != null) body("gateId" to gate.id, "deviceId" to d.deviceId, "id" to id, "passId" to passId)
            else body("gateId" to gate.id, "deviceId" to d.deviceId, "id" to id, "qr" to text, "scannedAt" to at, "queuedCount" to queue.size)
            val out: ScanResult = Api.post("/gate/scans", payload)
            online = true
            if (tokenId != null && ScanRules.isAdmit(out.result)) remember(tokenId, gate.zoneId, at)
            return out
        } catch (e: ApiException) {
            if (handleRevoked(e)) throw ApiException(410, "This device was removed from the event. Its saved data has been cleared.", "device_revoked")
            if (!e.offline || passId != null) throw e
            online = false
            val local = ScanRules.decideOffline(bundle, gate, history(), tokenId, at)
            if (tokenId != null && ScanRules.isAdmit(local.result)) remember(tokenId, gate.zoneId, at)
            saveQueue(queue + QueuedScan(id, gate.id, text, at, local.result))
            scheduleSync()
            return local
        }
    }

    // Uploads queued scans and refreshes the eligibility set. Returns the number of scans
    // another device had also admitted, or null when the server could not be reached.
    suspend fun sync(): Int? {
        val d = device ?: return 0
        if (syncing) return null
        syncing = true
        try {
            val pending = queue
            var conflicts = 0
            if (pending.isNotEmpty()) {
                val out: SyncOut = Api.post(
                    "/gate/scans/sync",
                    body("deviceId" to d.deviceId, "queuedCount" to 0, "scans" to json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(QueuedScan.serializer()), pending)),
                )
                conflicts = out.conflicts
                saveQueue(queue.filter { q -> pending.none { it.id == q.id } })
            } else Api.raw("POST", "/gate/devices/${d.deviceId}/heartbeat", body("queuedCount" to 0))
            loadBundle()
            online = true
            return conflicts
        } catch (e: ApiException) {
            if (handleRevoked(e)) return null
            if (e.offline) online = false
            return null
        } finally {
            syncing = false
        }
    }

    // Asks the system to run a sync as soon as there is a network, even if the app is closed.
    fun scheduleSync() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(appContext).enqueueUniqueWork("scan-sync", ExistingWorkPolicy.REPLACE, request)
    }
}

// Background upload of queued scans when connectivity returns.
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (Repo.queue.isEmpty()) return Result.success()
        return if (Repo.sync() != null) Result.success() else Result.retry()
    }
}
