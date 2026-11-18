package com.synervoz.openailivetoolkit

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The device's text-to-speech, rendered to WAV files in the cache so the engine plays them like the
 * model's voice. The same words in the same language come from the same file.
 */
internal class OpenAILiveToolkitSpeech(private val context: Context) {

  private class Request(val file: File, val completion: (String) -> Unit) {
    val part = File(file.path + ".part")
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  // On the main looper.
  private var engine: TextToSpeech? = null
  private var engineReady = false
  private val waitingForEngine = mutableListOf<(TextToSpeech?) -> Unit>()

  private val inProgress = ConcurrentHashMap<String, Request>()

  private val progress = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) {}

    override fun onDone(utteranceId: String) = finish(utteranceId, true)

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String) = finish(utteranceId, false)

    override fun onError(utteranceId: String, errorCode: Int) = finish(utteranceId, false)
  }

  /** Calls [completion] with the WAV file's path, or "" without a text-to-speech engine or when it fails. */
  fun synthesize(text: String, language: String, completion: (String) -> Unit) {
    val name = "openai-live-toolkit-speech-$language-${Integer.toHexString(text.hashCode())}.wav"
    val file = File(context.cacheDir, name)
    if (file.exists()) {
      completion(file.absolutePath)
      return
    }
    mainHandler.post {
      withEngine { engine ->
        if (engine == null) {
          completion("")
          return@withEngine
        }
        // An unsupported language keeps the engine's own.
        engine.setLanguage(Locale.forLanguageTag(language))
        val id = UUID.randomUUID().toString()
        val request = Request(file, completion)
        inProgress[id] = request
        if (engine.synthesizeToFile(text, Bundle(), request.part, id) != TextToSpeech.SUCCESS) {
          finish(id, false)
        }
      }
    }
  }

  fun shutdown() {
    mainHandler.post {
      engine?.shutdown()
      engine = null
      engineReady = false
      inProgress.keys.toList().forEach { finish(it, false) }
    }
  }

  /** Runs [block] with the started engine, or null when there is none. On the main looper. */
  private fun withEngine(block: (TextToSpeech?) -> Unit) {
    if (engineReady) {
      block(engine)
      return
    }
    waitingForEngine += block
    if (engine != null) {
      return
    }
    engine = TextToSpeech(context) { status ->
      val started = status == TextToSpeech.SUCCESS
      if (started) {
        engine?.setOnUtteranceProgressListener(progress)
        engineReady = true
      } else {
        // No engine installed, or it failed. The next request tries again.
        engine?.shutdown()
        engine = null
      }
      val ready = engine
      val blocks = waitingForEngine.toList()
      waitingForEngine.clear()
      blocks.forEach { it(ready) }
    }
  }

  private fun finish(utteranceId: String, done: Boolean) {
    val request = inProgress.remove(utteranceId) ?: return
    if (done && request.part.renameTo(request.file)) {
      request.completion(request.file.absolutePath)
      return
    }
    request.part.delete()
    request.completion("")
  }
}
