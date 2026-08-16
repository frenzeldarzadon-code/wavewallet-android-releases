plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.wavewallet.gcashlistener"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wavewallet.gcashlistener"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Default WaveWallet base URL. Override at pairing time in the app.
        buildConfigField("String", "DEFAULT_BASE_URL", "\"https://wallet.sagadawave.com\"")
        buildConfigField("String", "GCASH_PACKAGE", "\"com.globe.gcash.android\"")
    }

    // Signing material never lives in this repository. The release signing
    // config only exists when all four environment variables are supplied by
    // GitHub Actions secrets (WW_KEYSTORE, WW_KEYSTORE_PASSWORD, WW_KEY_ALIAS,
    // WW_KEY_PASSWORD). Without them the release build stays unsigned and the
    // debug build path is unaffected.
    val keystorePath = System.getenv("WW_KEYSTORE")
    val keystorePassword = System.getenv("WW_KEYSTORE_PASSWORD")
    val keyAlias = System.getenv("WW_KEY_ALIAS")
    val keyPasswordEnv = System.getenv("WW_KEY_PASSWORD")
    val hasSigningMaterial =
        !keystorePath.isNullOrBlank() &&
            !keystorePassword.isNullOrBlank() &&
            !keyAlias.isNullOrBlank() &&
            !keyPasswordEnv.isNullOrBlank() &&
            file(keystorePath).exists()

    if (hasSigningMaterial) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                keyPassword = keyPasswordEnv
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasSigningMaterial) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
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
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }

    // Robolectric unit tests need the merged Android resources.
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
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")

    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.ui:ui-tooling-preview")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // Google Tink (pulled in by security-crypto) references Error Prone
    // annotations at compile/shrink time; they are not published as a
    // transitive runtime dependency, so R8 fails the release build with
    // "missing class com.google.errorprone.annotations.*" without this.
    implementation("com.google.errorprone:error_prone_annotations:2.23.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.robolectric:robolectric:4.12.2")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
