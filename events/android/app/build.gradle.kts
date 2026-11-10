plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
// Firebase Cloud Messaging is wired in only when its config file is present, so the app
// builds and runs without push until the Firebase project exists.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.brainadz.events"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.brainadz.events"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // The host that pass and invitation links (Android App Links) point at.
        val apiBase = (project.findProperty("brainadz.apiBaseUrl") as String).trimEnd('/')
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
        manifestPlaceholders["linkHost"] = apiBase.substringAfter("://").substringBefore("/").substringBefore(":")
        manifestPlaceholders["cleartext"] = "false"
    }
    signingConfigs {
        // Release signing comes from the environment so no key material lives in the repository.
        create("release") {
            val store = System.getenv("BRAINADZ_KEYSTORE")
            if (store != null) {
                storeFile = file(store)
                storePassword = System.getenv("BRAINADZ_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("BRAINADZ_KEY_ALIAS")
                keyPassword = System.getenv("BRAINADZ_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        debug {
            // The emulator reaches a server on the development computer at 10.0.2.2.
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3100\"")
            applicationIdSuffix = ".debug"
            // Plain HTTP is allowed in debug builds only, for a server on the local network.
            manifestPlaceholders["cleartext"] = "true"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("BRAINADZ_KEYSTORE") != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Camera scanning: CameraX with ML Kit's bundled barcode model (works without Play services).
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    // QR rendering for passes.
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
}
