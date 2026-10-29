package com.ivanilson.mangatradutor

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Balão em pixels da tela, já com o texto traduzido. */
data class Balao(val l: Float, val t: Float, val r: Float, val b: Float, val texto: String)

object Tradutor {
    private const val PROMPT =
        "Esta imagem é um print de uma página de mangá, manhwa ou manhua. " +
        "Encontre cada balão de fala e caixa de texto e traduza o texto para português do Brasil, de forma natural. " +
        "Responda SOMENTE em JSON neste formato: " +
        "{\"baloes\":[{\"caixa\":[x1,y1,x2,y2],\"texto\":\"tradução\"}]} " +
        "com as coordenadas normalizadas de 0 a 1000 em relação à imagem (x a partir da esquerda, y a partir do topo), " +
        "cobrindo o balão inteiro. Ignore onomatopeias e textos da interface do aplicativo. " +
        "Se não houver texto, responda {\"baloes\":[]}."

    // shortcut: manda a tela inteira numa imagem só; se o texto pequeno sair ilegível, cortar em 2-3 faixas.
    fun traduzir(jpeg: ByteArray, w: Int, h: Int, chave: String, modelo: String): List<Balao> {
        val imagem = "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP)
        val conteudo = JSONArray()
            .put(JSONObject().put("type", "text").put("text", PROMPT))
            .put(JSONObject().put("type", "image_url").put("image_url", JSONObject().put("url", imagem)))
        val corpo = JSONObject()
            .put("model", modelo)
            .put("response_format", JSONObject().put("type", "json_object"))
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", conteudo)))

        val con = URL("https://api.deepseek.com/chat/completions").openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"
            con.doOutput = true
            con.connectTimeout = 15_000
            con.readTimeout = 90_000
            con.setRequestProperty("Content-Type", "application/json")
            con.setRequestProperty("Authorization", "Bearer $chave")
            con.outputStream.use { it.write(corpo.toString().toByteArray()) }
            val ok = con.responseCode in 200..299
            val resp = (if (ok) con.inputStream else con.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (!ok) throw IOException("API ${con.responseCode}: ${resp.take(300)}")
            val texto = JSONObject(resp).getJSONArray("choices").getJSONObject(0)
                .getJSONObject("message").getString("content")
            return interpretar(texto, w, h)
        } finally {
            con.disconnect()
        }
    }

    /** Converte a resposta do modelo em balões na escala da tela; ignora itens malformados. */
    fun interpretar(resposta: String, w: Int, h: Int): List<Balao> {
        val i = resposta.indexOf('{')
        val f = resposta.lastIndexOf('}')
        if (i < 0 || f <= i) return emptyList()
        val lista = JSONObject(resposta.substring(i, f + 1)).optJSONArray("baloes") ?: return emptyList()
        return (0 until lista.length()).mapNotNull { k ->
            val o = lista.optJSONObject(k) ?: return@mapNotNull null
            val c = o.optJSONArray("caixa") ?: return@mapNotNull null
            val texto = o.optString("texto").trim()
            if (c.length() != 4 || texto.isEmpty()) return@mapNotNull null
            val v = (0..3).map { c.optDouble(it) }
            if (v.any { it.isNaN() }) return@mapNotNull null
            val n = v.map { it.toFloat().coerceIn(0f, 1000f) / 1000f }
            val x1 = n[0] * w; val y1 = n[1] * h; val x2 = n[2] * w; val y2 = n[3] * h
            if (x1 == x2 || y1 == y2) return@mapNotNull null
            Balao(minOf(x1, x2), minOf(y1, y2), maxOf(x1, x2), maxOf(y1, y2), texto)
        }
    }
}
