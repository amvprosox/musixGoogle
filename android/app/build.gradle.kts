import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

val keystoreFile = rootProject.file("keystore.properties")
val keystore =
    Properties().apply {
        if (keystoreFile.isFile) {
            keystoreFile.inputStream().use { load(it) }
        }
    }

val fixtureAssets = layout.buildDirectory.dir("generated/fixtureAssets")

val copyFixtureAssets =
    tasks.register<Sync>("copyFixtureAssets") {
        from(rootProject.file("../desktop/tests/e2e/fixture")) {
            include("ytm.html", "ytm.js")
            into("fixture")
        }
        from(rootProject.file("../shared/bridge/tests/fixtures")) {
            include("*.json")
            into("fixture/innertube")
        }
        into(fixtureAssets)
    }

android {
    namespace = "com.realmadhoney.musix"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.realmadhoney.musix"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.0.3"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "platform"
    productFlavors {
        create("mobile") {
            dimension = "platform"
            buildConfigField("boolean", "AUTOMOTIVE", "false")
        }
        create("automotive") {
            dimension = "platform"
            buildConfigField("boolean", "AUTOMOTIVE", "true")
        }
    }

    signingConfigs {
        create("release") {
            if (keystore.getProperty("storeFile") != null) {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig =
                when {
                    keystore.getProperty("storeFile") != null -> signingConfigs.getByName("release")
                    providers.gradleProperty("musix.signWithDebugKey").orNull == "true" -> signingConfigs.getByName("debug")
                    else -> null
                }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    useLibrary("android.car", false)

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = false
        }
        animationsDisabled = true
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/LICENSE*", "/META-INF/NOTICE*")
        }
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        checkDependencies = true
        disable +=
            setOf(
                "GradleDependency",
                "NewerVersionAvailable",
                "AndroidGradlePluginVersion",
                "OldTargetApi",
            )
    }
}

androidComponents {
    onVariants { variant ->
        variant.androidTest?.sources?.assets?.addGeneratedSourceDirectory(copyFixtureAssets) { _ ->
            objects.directoryProperty().apply {
                set(fixtureAssets)
            }
        }
    }
}

kotlin {
    compilerOptions {
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.service)
    implementation(libs.media3.session)
    implementation(libs.webkit)
    implementation(libs.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.guava)
    implementation(libs.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.coil.compose)

    testImplementation(libs.junit)
    testImplementation(libs.truth)
    testImplementation(libs.robolectric)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.androidx.test.core)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.truth)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.uiautomator)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
