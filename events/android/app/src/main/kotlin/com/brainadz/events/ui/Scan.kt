// QR rendering for passes, the camera scanner (CameraX + ML Kit) with permission-denied
// recovery, and the 2D hall plan.
package com.brainadz.events.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.brainadz.events.data.Hall
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.util.concurrent.Executors

// The pass QR: black on white, drawn on the device from the opaque reference so it works offline.
@Composable
fun QrImage(text: String, description: String, modifier: Modifier = Modifier) {
    val bitmap = remember(text) {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 2))
        Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.RGB_565).apply {
            for (x in 0 until matrix.width) for (y in 0 until matrix.height)
                setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
    Image(bitmap.asImageBitmap(), description, modifier.aspectRatio(1f), filterQuality = FilterQuality.None)
}

// Live camera scanner. Reports each QR once every three seconds while it stays in view.
@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable
fun QrScanner(modifier: Modifier = Modifier, onCode: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val handler by rememberUpdatedState(onCode)
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by remember { mutableStateOf(false) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) request.launch(Manifest.permission.CAMERA) }

    if (!granted) {
        // Denied: say why the camera is needed and offer the way back.
        Column(modifier.fillMaxWidth().background(C.ErrorBg, RoundedCornerShape(8.dp)).padding(16.dp)) {
            Text("Camera access is off", fontWeight = FontWeight.SemiBold, color = C.Error)
            Text("The camera is used only to read QR codes. Allow it to scan, or type the code instead.", color = C.Error)
            Spacer(Modifier.size(8.dp))
            SecondaryButton(if (asked) "Open app settings" else "Allow camera") {
                if (asked) context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
                else request.launch(Manifest.permission.CAMERA)
            }
        }
        return
    }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    val last = remember { arrayOf("", 0L) }
    DisposableEffect(Unit) {
        onDispose {
            ProcessCameraProvider.getInstance(context).get().unbindAll()
            executor.shutdown()
            scanner.close()
        }
    }
    Box(modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(8.dp)).background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                val view = PreviewView(ctx)
                val future = ProcessCameraProvider.getInstance(ctx)
                future.addListener({
                    val provider = future.get()
                    val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                    val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                    analysis.setAnalyzer(executor) { proxy ->
                        val media = proxy.image
                        if (media == null) proxy.close()
                        else scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                            .addOnSuccessListener { codes ->
                                val value = codes.firstOrNull()?.rawValue
                                val now = System.currentTimeMillis()
                                if (value != null && (value != last[0] || now - (last[1] as Long) > 3000)) {
                                    last[0] = value; last[1] = now
                                    handler(value)
                                }
                            }
                            .addOnCompleteListener { proxy.close() }
                    }
                    runCatching {
                        provider.unbindAll()
                        provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                    }
                }, ContextCompat.getMainExecutor(ctx))
                view
            },
            modifier = Modifier.fillMaxSize().semantics { contentDescription = "Camera view. Hold the QR code inside the frame." },
        )
        Box(Modifier.align(Alignment.Center).fillMaxWidth(0.6f).aspectRatio(1f).border(3.dp, Color.White, RoundedCornerShape(8.dp)))
    }
}

// The 2D plan of one hall on a grid. Tapping a booth selects it. The same information is
// available as text in the list view the screens offer beside it.
@Composable
fun HallPlan(hall: Hall, selected: Int?, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    val measurer = rememberTextMeasurer()
    val pick by rememberUpdatedState(onSelect)
    val ratio = hall.cols.toFloat() / (hall.rows + 0.9f)
    Canvas(
        modifier.fillMaxWidth().aspectRatio(ratio)
            .semantics { contentDescription = "Plan of ${hall.name}. Switch to List for a text version." }
            .pointerInput(hall) {
                detectTapGestures { p ->
                    val cell = size.width / hall.cols.toFloat()
                    hall.booths.find { p.x >= it.x * cell && p.x <= (it.x + it.w) * cell && p.y >= it.y * cell && p.y <= (it.y + it.h) * cell }?.let { pick(it.id) }
                }
            },
    ) {
        val cell = size.width / hall.cols
        val wallH = hall.rows * cell
        drawRoundRect(C.Control, Offset.Zero, Size(size.width, wallH), CornerRadius(8f), style = Stroke(3.dp.toPx()))
        for (b in hall.booths) {
            val topLeft = Offset((b.x * cell + 4).toFloat(), (b.y * cell + 4).toFloat())
            val box = Size((b.w * cell - 8).toFloat(), (b.h * cell - 8).toFloat())
            val isSel = b.id == selected
            val taken = b.exhibitor != null
            if (isSel) drawRoundRect(C.Petrol, topLeft, box, CornerRadius(6f))
            else {
                drawRoundRect(C.Surface, topLeft, box, CornerRadius(6f))
                drawRoundRect(
                    if (taken) C.Ink else C.Control, topLeft, box, CornerRadius(6f),
                    style = Stroke(if (taken) 2.dp.toPx() else 1.dp.toPx(), pathEffect = if (taken) null else PathEffect.dashPathEffect(floatArrayOf(10f, 8f))),
                )
            }
            val label = measurer.measure(b.code, TextStyle(fontSize = 13.sp, fontWeight = if (taken) FontWeight.SemiBold else FontWeight.Normal, color = if (isSel) Color.White else if (taken) C.Ink else C.Ink2))
            drawText(label, topLeft = Offset(topLeft.x + (box.width - label.size.width) / 2, topLeft.y + (box.height - label.size.height) / 2))
        }
        for (a in hall.amenities) {
            val label = measurer.measure(a.label, TextStyle(fontSize = 10.sp, color = C.Ink2))
            val x = if (a.x > hall.cols / 2.0) (a.x * cell).toFloat() - label.size.width else (a.x * cell).toFloat()
            drawText(label, topLeft = Offset(x.coerceIn(4f, size.width - label.size.width - 4f), (a.y * cell).toFloat() - label.size.height / 2))
        }
        for (g in hall.gates) {
            val gx = ((g.x ?: continue) * cell).toFloat()
            drawLine(C.Surface, Offset(gx - cell * 0.6f, wallH), Offset(gx + cell * 0.6f, wallH), 5.dp.toPx())
            val label = measurer.measure("↑ ${g.name} entry", TextStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = C.Ink))
            drawText(label, topLeft = Offset(gx - label.size.width / 2, wallH + 6.dp.toPx()))
        }
    }
}
