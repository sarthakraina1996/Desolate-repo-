package com.brainadz.events

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.brainadz.events.data.Repo

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Repo.init(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }
    companion object {
        const val CHANNEL = "updates"
    }
}
