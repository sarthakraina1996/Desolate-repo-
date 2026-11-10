// Firebase Cloud Messaging: opt-in notifications for schedule and gate changes.
package com.brainadz.events

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.brainadz.events.data.Repo
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PushService : FirebaseMessagingService() {
    // A refreshed token replaces the old one on the server, keeping the person's choices.
    override fun onNewToken(token: String) {
        Repo.pushToken = token
        val topics = Repo.pushTopics
        if (Repo.signedIn && topics.isNotEmpty())
            CoroutineScope(Dispatchers.IO).launch { runCatching { Repo.setPush(token, topics) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification ?: return
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val built = NotificationCompat.Builder(this, App.CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(message.messageId.hashCode(), built)
    }
}
