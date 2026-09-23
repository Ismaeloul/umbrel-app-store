# Ideas para después de terminar la v2

Aparcadas por decisión de Isma (23-sep-2026, 08:00): primero se prueba que la
v2 funciona y después se van añadiendo.

## 1. Mapa competición → canales permitidos

Una tabla fija de qué canales pueden emitir cada competición (p. ej. LaLiga
EA Sports: M+ LaLiga, DAZN LaLiga, LaLiga TV Bar; LaLiga Hypermotion: LaLiga
TV Hypermotion). Un partido de Primera nunca acabaría en un canal de Segunda
aunque el nombre se parezca. Complementa la regla de "una palabra de
diferencia = 58 puntos como máximo" (B-150), que ya evita el caso
Barça → «Movistar LaLiga Hypermotion».

## 2. Modelo de lenguaje local como juez de desempates

Un LLM pequeño en Ollama (Qwen o Gemma de 1-3 B) que, solo ante varios
candidatos dudosos, responda en JSON si un canal emite un partido. Nunca por
encima de las reglas duras ni del mapa anterior; si Ollama no está o tarda,
todo sigue igual. En el N300, en el precalentado y no al pulsar
reproducir. Hoy ya se usa embeddinggemma para recuperar rótulos raros
(B-165), pero por debajo de las reglas, porque los embeddings ven casi
iguales «LaLiga» y «LaLiga Hypermotion».
