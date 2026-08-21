plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.wavewallet.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wavewallet.app"
        minSdk = 24
        targetSdk = 34
        // Native release containing the voucher ImageSaver bridge, the update
        // centre and the integrated GCash notification listener (previously a
        // separate app). Must match ANDROID_VERSION_* in src/lib/update-manifest.ts.
        versionCode = 4
        versionName = "1.2.0"

        // The one and only backend: the published WaveWallet web app.
        buildConfigField("String", "APP_URL", "\"https://wallet.sagadawave.com\"")
        buildConfigField("String", "APP_HOST", "\"wallet.sagadawave.com\"")
        buildConfigField("String", "ALT_HOST", "\"sagada-wave-wallet.lovable.app\"")
        // The single, compiled-in update destination. The web page can never
        // supply a different URL to the installer.
        buildConfigField("String", "UPDATE_URL", "\"https://wallet.sagadawave.com/download\"")
        // Integrated GCash listener: same endpoints and same pairing protocol
        // as the standalone listener app. No new backend is introduced.
        buildConfigField("String", "DEFAULT_BASE_URL", "\"https://wallet.sagadawave.com\"")
        buildConfigField("String", "GCASH_PACKAGE", "\"com.globe.gcash.android\"")
    }

    // Signing material never lives in this repository. The release signing
    // config only exists when all four environment variables are supplied by
    // GitHub Actions secrets (WW_APP_KEYSTORE, WW_APP_KEYSTORE_PASSWORD,
    // WW_APP_KEY_ALIAS, WW_APP_KEY_PASSWORD).
    val keystorePath = System.getenv("WW_APP_KEYSTORE")
    val keystorePassword = System.getenv("WW_APP_KEYSTORE_PASSWORD")
    val keyAliasEnv = System.getenv("WW_APP_KEY_ALIAS")
    val keyPasswordEnv = System.getenv("WW_APP_KEY_PASSWORD")
    val hasSigningMaterial =
        !keystorePath.isNullOrBlank() &&
            !keystorePassword.isNullOrBlank() &&
            !keyAliasEnv.isNullOrBlank() &&
            !keyPasswordEnv.isNullOrBlank() &&
            file(keystorePath).exists()

    if (hasSigningMaterial) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                keyAlias = keyAliasEnv
                keyPassword = keyPasswordEnv
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasSigningMaterial) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            // Same applicationId as release on purpose is NOT used: keep the
            // debug build side-loadable next to a real install for testing.
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        buildConfig = true
        compose = true
    }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    // --- Integrated GCash listener ---
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")

    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // Tink (via security-crypto) references Error Prone annotations at
    // compile/shrink time; they are not published transitively at runtime.
    implementation("com.google.errorprone:error_prone_annotations:2.23.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.robolectric:robolectric:4.12.2")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.test:core-ktx:1.6.1")
}
