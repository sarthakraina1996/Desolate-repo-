package com.brainadz.events

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import com.brainadz.events.ui.AppRoot
import com.brainadz.events.ui.EventsTheme

class MainActivity : ComponentActivity() {
    // The path of the link that opened the app (a pass link, an event link or /signin).
    private val link = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        link.value = intent?.data?.path
        setContent { EventsTheme { AppRoot(link.value) { link.value = null } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        link.value = intent.data?.path
    }
}
