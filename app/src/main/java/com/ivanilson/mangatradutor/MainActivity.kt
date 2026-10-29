package com.ivanilson.mangatradutor

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("cfg", MODE_PRIVATE) }
    private lateinit var chave: EditText
    private lateinit var modelo: EditText
    private lateinit var interruptor: Switch
    private lateinit var estado: TextView

    private val corFundo = 0xFF0E0F14.toInt()
    private val corCartao = 0xFF181A22.toInt()
    private val corCampo = 0xFF22252F.toInt()
    private val corTexto = 0xFFEDEDF3.toInt()
    private val corSuave = 0xFF9A9CAB.toInt()
    private val corDestaque = 0xFF8B5CF6.toInt()

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = corFundo
        window.navigationBarColor = corFundo

        chave = campo("Cole aqui sua chave sk-…", prefs.getString("chave", "")).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        modelo = campo("deepseek-flash", prefs.getString("modelo", "deepseek-flash"))
        interruptor = Switch(this).apply {
            thumbTintList = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(Color.WHITE, 0xFFB0B2C0.toInt())
            )
            trackTintList = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(corDestaque, 0xFF3A3D4A.toInt())
            )
            contentDescription = "Botão flutuante"
        }
        estado = texto("", 13f, corSuave)

        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))

            addView(LinearLayout(this@MainActivity).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(ImageView(this@MainActivity).apply {
                    setImageResource(R.mipmap.ic_launcher)
                    outlineProvider = object : ViewOutlineProvider() {
                        override fun getOutline(v: View, o: Outline) = o.setRoundRect(0, 0, v.width, v.height, dp(16).toFloat())
                    }
                    clipToOutline = true
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                }, LinearLayout.LayoutParams(dp(56), dp(56)))
                addView(LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), 0, 0, 0)
                    addView(texto("Manga Tradutor", 24f, corTexto, negrito = true))
                    addView(texto("Traduz os balões direto na tela", 14f, corSuave))
                })
            })

            addView(cartao(
                LinearLayout(this@MainActivity).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        addView(texto("Botão flutuante", 17f, corTexto, negrito = true))
                        addView(estado)
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                    addView(interruptor)
                }
            ))

            addView(cartao(
                texto("Chave da API DeepSeek", 15f, corTexto, negrito = true),
                chave,
                texto("Modelo", 13f, corSuave).apply { setPadding(0, dp(12), 0, dp(6)) },
                modelo
            ))

            addView(cartao(
                texto("Como usar", 15f, corTexto, negrito = true),
                texto(
                    "•  Toque no PT para traduzir a tela\n" +
                        "•  Toque na tradução para fechar\n" +
                        "•  Segure o PT para abrir o menu\n" +
                        "•  Arraste o PT para mudar de lugar",
                    14f, corSuave
                ).apply { setLineSpacing(dp(6).toFloat(), 1f) }
            ))
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(corFundo); addView(raiz) })
    }

    override fun onResume() {
        super.onResume()
        atualizarTela()
    }

    override fun onPause() {
        super.onPause()
        salvar()
    }

    private fun salvar() {
        prefs.edit()
            .putString("chave", chave.text.toString().trim())
            .putString("modelo", modelo.text.toString().trim().ifEmpty { "deepseek-flash" })
            .apply()
    }

    private fun atualizarTela() {
        val servico = TradutorService.instancia != null
        val ativo = servico && prefs.getBoolean("ativo", true)
        interruptor.setOnCheckedChangeListener(null)
        interruptor.isChecked = ativo
        interruptor.setOnCheckedChangeListener { _, ligado -> alternar(ligado) }
        estado.text = when {
            !servico -> "Precisa liberar na acessibilidade"
            ativo -> "Ativo sobre os outros apps"
            else -> "Desativado"
        }
        estado.setTextColor(if (ativo) 0xFF4ADE80.toInt() else corSuave)
    }

    private fun alternar(ligado: Boolean) {
        salvar()
        prefs.edit().putBoolean("ativo", ligado).apply()
        if (ligado && TradutorService.instancia == null) {
            atualizarTela()
            AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Liberar o botão")
                .setMessage(
                    "O app usa a acessibilidade para mostrar o botão e tirar o print só quando você toca nele, " +
                        "sem o aviso vermelho de gravação.\n\nNa próxima tela, abra \"Manga Tradutor\" e ative."
                )
                .setPositiveButton("Abrir configurações") { _, _ ->
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }
                .setNegativeButton("Agora não", null)
                .show()
            return
        }
        TradutorService.instancia?.atualizar()
        atualizarTela()
    }

    private fun texto(t: String, tamanho: Float, cor: Int, negrito: Boolean = false) = TextView(this).apply {
        text = t
        textSize = tamanho
        setTextColor(cor)
        if (negrito) typeface = Typeface.DEFAULT_BOLD
    }

    private fun campo(dica: String, valor: String?) = EditText(this).apply {
        hint = dica
        setText(valor)
        setTextColor(corTexto)
        setHintTextColor(0xFF6B6E7D.toInt())
        textSize = 15f
        isSingleLine = true
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(corCampo) }
    }

    private fun cartao(vararg filhos: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(18), dp(18), dp(18))
        background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(corCartao) }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) }
        filhos.forEachIndexed { i, v ->
            addView(v, LinearLayout.LayoutParams(-1, -2).apply { if (i == 1 && v is EditText) topMargin = dp(10) })
        }
    }
}
