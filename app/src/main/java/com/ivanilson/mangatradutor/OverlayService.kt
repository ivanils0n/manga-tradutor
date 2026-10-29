package com.ivanilson.mangatradutor

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import java.io.ByteArrayOutputStream
import kotlin.math.abs

class OverlayService : Service() {
    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private val captura = HandlerThread("captura").apply { start() }
    private var projecao: MediaProjection? = null
    private var leitor: ImageReader? = null
    private var tela: VirtualDisplay? = null
    private val trava = Any()
    private var ultimo: Image? = null // último quadro da tela, guardado porque a tela parada não gera quadro novo
    private var botao: TextView? = null
    private lateinit var botaoParams: WindowManager.LayoutParams
    private var camada: View? = null
    private var ocupado = false

    override fun onBind(intent: Intent?) = null

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (projecao != null || intent == null) return START_NOT_STICKY

        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("tradutor", "Tradutor", NotificationManager.IMPORTANCE_LOW))
        val notif = Notification.Builder(this, "tradutor")
            .setContentTitle("Manga Tradutor ativo")
            .setContentText("Segure o botão PT para encerrar")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(1, notif)
        }

        val dados: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("data", Intent::class.java)
        else intent.getParcelableExtra("data")
        val p = dados?.let {
            getSystemService(MediaProjectionManager::class.java).getMediaProjection(intent.getIntExtra("code", 0), it)
        }
        if (p == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        // Android 14+ exige o callback antes de criar a tela virtual
        p.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { main.post { stopSelf() } }
        }, main)
        projecao = p

        wm = getSystemService(WindowManager::class.java)
        val m = DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(m)
        // shortcut: tamanho fixo no início; girar a tela desalinha, reiniciar o serviço resolve.
        val r = ImageReader.newInstance(m.widthPixels, m.heightPixels, PixelFormat.RGBA_8888, 3)
        r.setOnImageAvailableListener({ ir ->
            val img = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
            synchronized(trava) { ultimo?.close(); ultimo = img }
        }, Handler(captura.looper))
        leitor = r
        tela = p.createVirtualDisplay(
            "captura", m.widthPixels, m.heightPixels, m.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, null
        )
        criarBotao()
        return START_NOT_STICKY
    }

    private fun params(w: Int, h: Int, flags: Int) = WindowManager.LayoutParams(
        w, h, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        if (Build.VERSION.SDK_INT >= 28) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun criarBotao() {
        val tam = (56 * resources.displayMetrics.density).toInt()
        val b = TextView(this).apply {
            text = "PT"
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER
            contentDescription = "Traduzir tela"
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xDD3F51B5.toInt())
            }
        }
        botaoParams = params(tam, tam, 0).apply { x = 0; y = tam * 4 }
        var ix = 0; var iy = 0; var tx = 0f; var ty = 0f; var t0 = 0L; var moveu = false
        b.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    ix = botaoParams.x; iy = botaoParams.y; tx = e.rawX; ty = e.rawY; t0 = e.eventTime; moveu = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - tx; val dy = e.rawY - ty
                    if (abs(dx) + abs(dy) > tam / 4) moveu = true
                    if (moveu) {
                        botaoParams.x = ix + dx.toInt(); botaoParams.y = iy + dy.toInt()
                        wm.updateViewLayout(b, botaoParams)
                    }
                }
                MotionEvent.ACTION_UP -> if (!moveu) {
                    if (e.eventTime - t0 > 700) stopSelf() else clicar()
                }
            }
            true
        }
        wm.addView(b, botaoParams)
        botao = b
    }

    private fun clicar() {
        val b = botao ?: return
        if (ocupado) return
        if (camada != null) return fecharCamada()
        ocupado = true
        b.visibility = View.INVISIBLE // some do print
        main.postDelayed({
            val bmp = synchronized(trava) { ultimo?.let(::paraBitmap) }
            b.visibility = View.VISIBLE
            if (bmp == null) return@postDelayed fim("Nenhuma imagem capturada")
            b.text = "…"
            val prefs = getSharedPreferences("cfg", MODE_PRIVATE)
            val chave = prefs.getString("chave", "").orEmpty()
            val modelo = prefs.getString("modelo", "deepseek-flash").orEmpty()
            Thread {
                try {
                    val jpeg = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
                    val baloes = Tradutor.traduzir(jpeg, bmp.width, bmp.height, chave, modelo)
                    main.post {
                        if (baloes.isEmpty()) fim("Nenhum texto encontrado") else { fim(null); mostrar(baloes) }
                    }
                } catch (e: Exception) {
                    main.post { fim("Erro: ${e.message}") }
                }
            }.start()
        }, 300)
    }

    private fun fim(msg: String?) {
        ocupado = false
        botao?.text = "PT"
        if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    private fun paraBitmap(img: Image): Bitmap {
        val p = img.planes[0]
        val largura = p.rowStride / p.pixelStride // a linha pode ter sobra no fim
        val bmp = Bitmap.createBitmap(largura, img.height, Bitmap.Config.ARGB_8888)
        p.buffer.rewind()
        bmp.copyPixelsFromBuffer(p.buffer)
        return Bitmap.createBitmap(bmp, 0, 0, img.width, img.height)
    }

    private fun mostrar(baloes: List<Balao>) {
        val b = botao ?: return
        if (projecao == null) return
        val d = resources.displayMetrics.density
        val fundo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val tinta = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; typeface = Typeface.DEFAULT_BOLD }
        val v = object : View(this) {
            override fun onDraw(c: Canvas) {
                for (x in baloes) {
                    val w = (x.r - x.l).toInt().coerceAtLeast(1)
                    val h = x.b - x.t
                    c.drawRoundRect(x.l, x.t, x.r, x.b, 8 * d, 8 * d, fundo)
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

    override fun onDestroy() {
        fecharCamada()
        botao?.let { wm.removeView(it) }
        botao = null
        projecao?.let { projecao = null; it.stop() }
        tela?.release()
        leitor?.close()
        synchronized(trava) { ultimo?.close(); ultimo = null }
        captura.quitSafely()
        super.onDestroy()
    }
}
