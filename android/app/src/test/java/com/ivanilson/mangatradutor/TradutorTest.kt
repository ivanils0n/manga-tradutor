package com.ivanilson.mangatradutor

import org.junit.Assert.assertEquals
import org.junit.Test

class TradutorTest {
    @Test
    fun converteCaixasEIgnoraItensRuins() {
        val resposta = "```json\n{\"baloes\":[" +
            "{\"caixa\":[100,200,300,400],\"texto\":\"Olá\"}," +
            "{\"caixa\":[300,450,100,400],\"texto\":\"Invertida\"}," +
            "{\"caixa\":[1,2],\"texto\":\"curta\"}," +
            "{\"caixa\":[5,5,9,9],\"texto\":\"  \"}]}\n```"
        assertEquals(
            listOf(Balao(100f, 400f, 300f, 800f, "Olá"), Balao(100f, 800f, 300f, 900f, "Invertida")),
            Tradutor.interpretar(resposta, 1000, 2000)
        )
    }

    @Test
    fun semJsonDevolveVazio() {
        assertEquals(emptyList<Balao>(), Tradutor.interpretar("não achei nada", 10, 10))
    }
}
