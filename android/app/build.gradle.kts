plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ivanilson.mangatradutor"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ivanilson.mangatradutor"
        minSdk = 30 // print pela acessibilidade (takeScreenshot) exige Android 11+
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // Chave fixa no repositório: cada build do GitHub sai com a mesma assinatura,
    // então o APK novo instala por cima do antigo sem desinstalar.
    signingConfigs {
        getByName("debug") { storeFile = file("debug.keystore") }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
