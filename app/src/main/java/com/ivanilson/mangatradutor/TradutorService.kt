package com.ivanilson.mangatradutor

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.sqrt

class TradutorService : AccessibilityService() {
    companion object {
        /** Serviço ligado nas configurações de acessibilidade; null quando desligado. */
        var instancia: TradutorService? = null
            private set
    }

    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private val prefs get() = getSharedPreferences("cfg", MODE_PRIVATE)
    private var botao: FrameLayout? = null
    private lateinit var rotulo: TextView
    private lateinit var carregando: ProgressBar
    private lateinit var botaoParams: WindowManager.LayoutParams
    private var camada: View? = null
    private var menu: View? = null
    private var ocupado = false

    override fun onServiceConnected() {
        wm = getSystemService(WindowManager::class.java)
        instancia = this
        atualizar()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        instancia = null
        esconder()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instancia = null
        esconder()
        super.onDestroy()
    }

    /** Mostra ou esconde o botão conforme o interruptor do app. */
    fun atualizar() {
        if (prefs.getBoolean("ativo", true)) mostrarBotao() else esconder()
    }

    private fun esconder() {
        if (!::wm.isInitialized) return
        fecharMenu()
        fecharCamada()
        botao?.let { wm.removeView(it) }
        botao = null
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun params(w: Int, h: Int, flags: Int = 0) = WindowManager.LayoutParams(
        w, h, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun mostrarBotao() {
        if (botao != null) return
        val tam = dp(58)
        rotulo = TextView(this).apply {
            text = "PT"
            setTextColor(Color.WHITE)
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        carregando = ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(Color.WHITE)
            visibility = View.GONE
        }
        val b = FrameLayout(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF6366F1.toInt(), 0xFFA855F7.toInt())
            ).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(2), 0x66FFFFFF)
            }
            contentDescription = "Traduzir tela. Segure para mais opções"
            addView(rotulo, FrameLayout.LayoutParams(-1, -1))
            addView(carregando, FrameLayout.LayoutParams(dp(30), dp(30), Gravity.CENTER))
        }
        botaoParams = params(tam, tam).apply { x = prefs.getInt("bx", 0); y = prefs.getInt("by", tam * 4) }

        var ix = 0; var iy = 0; var tx = 0f; var ty = 0f; var moveu = false; var segurou = false
        val segurar = Runnable { segurou = true; vibrar(); abrirMenu() }
        b.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    ix = botaoParams.x; iy = botaoParams.y; tx = e.rawX; ty = e.rawY
                    moveu = false; segurou = false
                    main.postDelayed(segurar, 500)
                }
                MotionEvent.ACTION_MOVE -> if (!segurou) {
                    val dx = e.rawX - tx; val dy = e.rawY - ty
                    if (!moveu && abs(dx) + abs(dy) > tam / 4) { moveu = true; main.removeCallbacks(segurar) }
                    if (moveu) {
                        botaoParams.x = ix + dx.toInt(); botaoParams.y = iy + dy.toInt()
                        wm.updateViewLayout(b, botaoParams)
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(segurar)
                    if (moveu) encostar() else if (!segurou && e.action == MotionEvent.ACTION_UP) clicar()
                }
            }
            true
        }
        wm.addView(b, botaoParams)
        botao = b
    }

    /** Depois de arrastar, o botão desliza para a borda mais próxima. */
    private fun encostar() {
        val b = botao ?: return
        val larg = resources.displayMetrics.widthPixels
        val alvo = if (botaoParams.x + b.width / 2 < larg / 2) 0 else larg - b.width
        prefs.edit().putInt("bx", alvo).putInt("by", botaoParams.y).apply()
        ValueAnimator.ofInt(botaoParams.x, alvo).apply {
            duration = 180
            addUpdateListener {
                botaoParams.x = it.animatedValue as Int
                botao?.let { v -> wm.updateViewLayout(v, botaoParams) }
            }
        }.start()
    }

    private fun vibrar() {
        val v = if (Build.VERSION.SDK_INT >= 31) getSystemService(VibratorManager::class.java).defaultVibrator
        else getSystemService(Vibrator::class.java)
        v?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun abrirMenu() {
        fecharMenu()
        val b = botao ?: return
        fun item(texto: String, acao: () -> Unit) = TextView(this).apply {
            text = texto
            setTextColor(0xFFEDEDF3.toInt())
            textSize = 15f
            setPadding(dp(20), dp(14), dp(20), dp(14))
            setOnClickListener { fecharMenu(); acao() }
        }
        val caixa = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0xF21E2130.toInt())
                setStroke(1, 0x33FFFFFF)
            }
            addView(item("Traduzir esta tela") { clicar() })
            addView(View(this@TradutorService).apply { setBackgroundColor(0x22FFFFFF) }, LinearLayout.LayoutParams(-1, 1))
            addView(item("Desativar botão") {
                prefs.edit().putBoolean("ativo", false).apply()
                esconder()
            })
            setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_OUTSIDE) fecharMenu(); false }
        }
        val larg = resources.displayMetrics.widthPixels
        val p = params(-2, -2, WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH).apply {
            y = botaoParams.y
            if (botaoParams.x + b.width / 2 > larg / 2) { // botão na direita: menu à esquerda dele
                gravity = Gravity.TOP or Gravity.END
                x = larg - botaoParams.x + dp(8)
            } else {
                x = botaoParams.x + b.width + dp(8)
            }
        }
        wm.addView(caixa, p)
        menu = caixa
    }

    private fun fecharMenu() {
        menu?.let { wm.removeView(it) }
        menu = null
    }

    private fun clicar() {
        val b = botao ?: return
        if (ocupado) return
        if (camada != null) return fecharCamada()
        if (prefs.getString("chave", "").isNullOrBlank()) return aviso("Abra o Manga Tradutor e cole a chave da API")
        ocupado = true
        b.visibility = View.INVISIBLE // some do print
        main.postDelayed({
            takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
                override fun onSuccess(r: ScreenshotResult) {
                    val bmp = Bitmap.wrapHardwareBuffer(r.hardwareBuffer, r.colorSpace)
                        ?.copy(Bitmap.Config.ARGB_8888, false)
                    r.hardwareBuffer.close()
                    b.visibility = View.VISIBLE
                    if (bmp == null) fim("Não consegui capturar a tela") else enviar(bmp)
                }

                override fun onFailure(codigo: Int) {
                    b.visibility = View.VISIBLE
                    fim("Não consegui capturar a tela (erro $codigo)")
                }
            })
        }, 200)
    }

    private fun enviar(bmp: Bitmap) {
        rotulo.visibility = View.GONE
        carregando.visibility = View.VISIBLE
        val chave = prefs.getString("chave", "").orEmpty()
        val modelo = prefs.getString("modelo", "deepseek-flash").orEmpty()
        Thread {
            try {
                // a API reduz para ~800x800 de qualquer jeito; mandar menor só acelera o upload
                val escala = sqrt(640_000.0 / (bmp.width * bmp.height)).coerceAtMost(1.0)
                val envio = Bitmap.createScaledBitmap(bmp, (bmp.width * escala).toInt(), (bmp.height * escala).toInt(), true)
                val jpeg = ByteArrayOutputStream().also { envio.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
                val baloes = Tradutor.traduzir(jpeg, bmp.width, bmp.height, chave, modelo)
                main.post {
                    if (baloes.isEmpty()) fim("Nenhum texto encontrado") else { fim(null); mostrar(baloes) }
                }
            } catch (e: Exception) {
                main.post { fim("Erro: ${e.message}") }
            }
        }.start()
    }

    private fun fim(msg: String?) {
        ocupado = false
        if (botao != null) {
            rotulo.visibility = View.VISIBLE
            carregando.visibility = View.GONE
        }
        if (msg != null) aviso(msg)
    }

    private fun aviso(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun mostrar(baloes: List<Balao>) {
        val b = botao ?: return
        val d = resources.displayMetrics.density
        val fundo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val borda = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0x33000000
            style = Paint.Style.STROKE
            strokeWidth = d
        }
        val tinta = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF111111.toInt(); typeface = Typeface.DEFAULT_BOLD }
        val v = object : View(this) {
            override fun onDraw(c: Canvas) {
                for (x in baloes) {
                    val w = (x.r - x.l).toInt().coerceAtLeast(1)
                    val h = x.b - x.t
                    c.drawRoundRect(x.l, x.t, x.r, x.b, 10 * d, 10 * d, fundo)
                    c.drawRoundRect(x.l, x.t, x.r, x.b, 10 * d, 10 * d, borda)
                    var tamanho = 18 * d
                    var lay: StaticLayout
                    do { // diminui a fonte até caber no balão
                        tinta.textSize = tamanho
                        lay = StaticLayout.Builder.obtain(x.texto, 0, x.texto.length, tinta, w)
                            .setAlignment(Layout.Alignment.ALIGN_CENTER).build()
                        tamanho -= d
                    } while (lay.height > h && tamanho > 7 * d)
                    c.save()
                    c.translate(x.l, x.t + maxOf(0f, (h - lay.height) / 2))
                    lay.draw(c)
                    c.restore()
                }
            }
        }
        v.contentDescription = baloes.joinToString("\n") { it.texto }
        v.setOnClickListener { fecharCamada() }
        wm.addView(v, params(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        ))
        camada = v
        wm.removeView(b) // recoloca o botão por cima da tradução
        wm.addView(b, botaoParams)
    }

    private fun fecharCamada() {
        camada?.let { wm.removeView(it) }
        camada = null
    }
}
