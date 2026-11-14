// The first screen for anyone not signed in: sign-in over the exhibition's own background
// photo (or the BrainADZ Live navy and red when the organiser has not set one).
package com.brainadz.events.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.brainadz.events.R
import com.brainadz.events.data.Api
import com.brainadz.events.data.Repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request

private val NavyDeep = Color(0xFF14244F)

// Downloads an image from the event server, shrunk to roughly screen size, or null.
@Composable
fun rememberRemoteImage(path: String?): ImageBitmap? {
    var image by remember(path) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(path) {
        if (path == null) return@LaunchedEffect
        image = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = Api.http.newCall(Request.Builder().url(Api.baseUrl + path).build()).execute().use { r ->
                    if (r.isSuccessful) r.body?.bytes() else null
                } ?: return@runCatching null
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= 1400) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }
    }
    return image
}

@Composable
fun WelcomeScreen(onDone: () -> Unit, onRegister: () -> Unit, onBrowse: () -> Unit) {
    val event = Repo.guide?.event
    val photo = rememberRemoteImage(event?.loginImage)
    Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF233E85), NavyDeep)))) {
        photo?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        // A dark wash keeps white text readable on any photo; a red glow echoes the brand.
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x800E1A3D), Color(0xD90E1A3D), NavyDeep))))
        Canvas(Modifier.fillMaxSize()) {
            val r = size.width * 0.95f
            drawCircle(Brush.radialGradient(listOf(Color(0x8CC82026), Color.Transparent), Offset(size.width, 0f), r), r, Offset(size.width, 0f))
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Spacer(Modifier.height(28.dp))
            if (event != null) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${dateRange(event.startsOn, event.endsOn)} · ${event.openTime}–${event.closeTime}",
                        Modifier.background(C.Petrol, RoundedCornerShape(4.dp)).padding(horizontal = 10.dp, vertical = 3.dp),
                        color = Color.White, fontWeight = FontWeight.SemiBold,
                    )
                    Text(event.name, color = Color.White, fontSize = 38.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                    event.tagline?.let { Text(it, color = Color.White.copy(alpha = 0.9f), fontSize = 17.sp) }
                    Text(listOfNotNull(event.venueName, event.city).joinToString(", "), color = Color.White.copy(alpha = 0.8f), fontWeight = FontWeight.Medium)
                }
            }
            Column(
                Modifier.fillMaxWidth().background(C.Surface, RoundedCornerShape(16.dp)).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Image(painterResource(R.drawable.brand_logo), "BrainADZ Live", Modifier.width(132.dp))
                Text("Sign in", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
                Text("Visitors, exhibitors and event staff all sign in here.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                SignInFields(onDone)
                Divider()
                event?.let { Text("New to ${it.name}?", color = C.Ink2) }
                SecondaryButton("Register for a ticket", onClick = onRegister)
                LinkButton("Look around without signing in", onClick = onBrowse)
            }
        }
    }
}
