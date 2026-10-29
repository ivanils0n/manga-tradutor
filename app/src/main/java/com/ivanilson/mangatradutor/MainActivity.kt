package com.ivanilson.mangatradutor

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("cfg", MODE_PRIVATE) }
    private lateinit var chave: EditText
    private lateinit var modelo: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)

        val p = (16 * resources.displayMetrics.density).toInt()
        chave = EditText(this).apply {
            hint = "Chave da API DeepSeek"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(prefs.getString("chave", ""))
        }
        modelo = EditText(this).apply {
            hint = "Modelo"
            setText(prefs.getString("modelo", "deepseek-flash"))
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(p, p, p, p)
            addView(TextView(this@MainActivity).apply {
                text = "1. Cole sua chave da DeepSeek\n" +
                    "2. Toque Iniciar e permita sobrepor e gravar a tela (escolha a tela inteira)\n" +
                    "3. No app de mangá, toque no botão PT\n\n" +
                    "Toque na tradução para fechar. Segure o botão para encerrar."
            })
            addView(chave)
            addView(modelo)
            addView(Button(this@MainActivity).apply { text = "Iniciar"; setOnClickListener { iniciar() } })
            addView(Button(this@MainActivity).apply {
                text = "Parar"
                setOnClickListener { stopService(Intent(this@MainActivity, OverlayService::class.java)) }
            })
        })
    }

    private fun iniciar() {
        val k = chave.text.toString().trim()
        if (k.isEmpty()) return aviso("Cole a chave da API")
        prefs.edit()
            .putString("chave", k)
            .putString("modelo", modelo.text.toString().trim().ifEmpty { "deepseek-flash" })
            .apply()
        if (!Settings.canDrawOverlays(this)) {
            aviso("Permita sobrepor a outros apps e toque Iniciar de novo")
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return
        }
        startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(), 2)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 2 || resultCode != RESULT_OK || data == null) return aviso("Gravação de tela negada")
        startForegroundService(Intent(this, OverlayService::class.java).putExtra("code", resultCode).putExtra("data", data))
        finish()
    }

    private fun aviso(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
