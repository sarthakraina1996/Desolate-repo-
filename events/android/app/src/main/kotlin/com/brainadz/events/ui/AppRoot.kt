// Navigation by role. Visitors get Pass, Explore, Agenda and Profile. Exhibitor staff get
// their booth workspace; gate staff get the restricted scanner. The roles come from the
// server (/me) and every action is checked there again.
package com.brainadz.events.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ConfirmationNumber
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.brainadz.events.data.Repo
import kotlinx.coroutines.launch

enum class Mode { VISITOR, EXHIBITOR, GATE }
private data class Tab(val key: String, val label: String, val icon: ImageVector)

@Composable
fun AppRoot(link: String?, onLinkHandled: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableStateOf("pass") }
    var overlay by rememberSaveable { mutableStateOf<String?>(null) } // "signin" or "register"
    var chosen by rememberSaveable { mutableStateOf<Mode?>(null) }

    LaunchedEffect(Unit) { Repo.start() }
    // Coming back to the app refreshes passes and uploads any queued scans.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (Repo.ready) scope.launch { Repo.start() } }
    // Links that opened the app are resolved against whoever is signed in.
    LaunchedEffect(link) {
        when {
            link == null -> return@LaunchedEffect
            link.startsWith("/p/") -> { runCatching { Repo.openPassLink(link.removePrefix("/p/")) }.onFailure { snackbar.showSnackbar(it.message ?: "That pass link is no longer valid.") }; chosen = Mode.VISITOR; tab = "pass" }
            link.startsWith("/e/") -> { runCatching { Repo.loadGuide(link.removePrefix("/e/").substringBefore("/")) }; chosen = Mode.VISITOR; tab = "explore" }
            link == "/signin" && !Repo.signedIn -> overlay = "signin"
        }
        onLinkHandled()
    }

    val exhibitor = Repo.me.exhibitor.firstOrNull { it.status == "approved" } ?: Repo.me.exhibitor.firstOrNull()
    val modes = buildList {
        add(Mode.VISITOR to "Visitor: my pass, explore, agenda")
        exhibitor?.let { add(Mode.EXHIBITOR to "Exhibitor: ${it.companyName}") }
        if (Repo.me.gate.isNotEmpty()) add(Mode.GATE to "Gate scanner")
    }
    // Staff land in their workspace; everyone can switch from Profile.
    val mode = chosen?.takeIf { m -> modes.any { it.first == m } } ?: when {
        Repo.me.gate.isNotEmpty() -> Mode.GATE
        exhibitor != null -> Mode.EXHIBITOR
        else -> Mode.VISITOR
    }
    val tabs = when (mode) {
        Mode.VISITOR -> listOf(Tab("pass", "Pass", Icons.Outlined.ConfirmationNumber), Tab("explore", "Explore", Icons.Outlined.Map), Tab("agenda", "Agenda", Icons.Outlined.CalendarMonth), Tab("profile", "Profile", Icons.Outlined.Person))
        Mode.EXHIBITOR -> listOf(Tab("booth", "Booth", Icons.Outlined.Storefront), Tab("team", "Team", Icons.Outlined.Badge), Tab("leads", "Leads", Icons.Outlined.Groups), Tab("scan", "Scan", Icons.Outlined.QrCodeScanner), Tab("profile", "Profile", Icons.Outlined.Person))
        Mode.GATE -> listOf(Tab("gate", "Scan", Icons.Outlined.QrCodeScanner), Tab("profile", "Profile", Icons.Outlined.Person))
    }
    val current = tabs.find { it.key == tab }?.key ?: tabs.first().key
    BackHandler(overlay != null) { overlay = null }

    CompositionLocalProvider(LocalToast provides { message -> scope.launch { snackbar.showSnackbar(message) } }) {
        Scaffold(
            containerColor = C.Canvas,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (overlay == null && Repo.ready) NavigationBar(containerColor = C.Surface) {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = t.key == current, onClick = { tab = t.key },
                            icon = { Icon(t.icon, null) }, label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = C.Selected, selectedIconColor = C.Petrol, selectedTextColor = C.Petrol, unselectedIconColor = C.Ink, unselectedTextColor = C.Ink),
                        )
                    }
                }
            },
        ) { inner ->
            Box(Modifier.fillMaxSize().padding(inner)) {
                val guide = Repo.guide
                when {
                    !Repo.ready -> Centered { CircularProgressIndicator(color = C.Petrol) }
                    overlay == "signin" -> SignInScreen { overlay = null }
                    overlay == "register" && guide != null -> RegisterScreen(guide) { overlay = null; tab = "pass" }
                    current == "pass" -> PassScreen({ overlay = "register" }, { if (Repo.signedIn) scope.launch { Repo.start() } else overlay = "signin" })
                    current == "explore" || current == "agenda" ->
                        if (guide == null) Centered { Text(if (Repo.online) "No event is open yet." else "You are offline and no event guide is saved on this phone yet.", color = C.Ink2) }
                        else if (current == "explore") ExploreScreen(guide) else AgendaScreen(guide)
                    current == "booth" -> BoothScreen(exhibitor!!)
                    current == "team" -> TeamScreen(exhibitor!!)
                    current == "leads" -> LeadsScreen(exhibitor!!)
                    current == "scan" -> LeadScanScreen(exhibitor!!)
                    current == "gate" -> GateScreen()
                    else -> ProfileScreen(modes, mode, { chosen = it; tab = "" }) { overlay = "signin" }
                }
            }
        }
    }
}
