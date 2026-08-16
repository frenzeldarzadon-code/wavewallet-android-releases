plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.wavewallet.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wavewallet.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        // The one and only backend: the published WaveWallet web app.
        buildConfigField("String", "APP_URL", "\"https://wallet.sagadawave.com\"")
        buildConfigField("String", "APP_HOST", "\"wallet.sagadawave.com\"")
        buildConfigField("String", "ALT_HOST", "\"sagada-wave-wallet.lovable.app\"")
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

    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    testImplementation("junit:junit:4.13.2")
}
