'use strict';

// OpenAI-compatible LLM client.
// Works with Ollama, LM Studio, llama.cpp server, vLLM, LocalAI, etc.
class LLMClient {
  constructor(baseUrl, model) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  // Stream a chat response via /v1/chat/completions (Server-Sent Events).
  async chat(systemPrompt, userMessage, onChunk, onDone, onError) {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true
    });

    let response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
    } catch (err) {
      onError(`Cannot connect to LLM server at ${this.baseUrl}.\nError: ${err.message}`);
      return;
    }

    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch (_) {}
      onError(`Server returned HTTP ${response.status}: ${detail}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    const finish = () => {
      if (!finished) { finished = true; onDone(); }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') { finish(); return; }
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) onChunk(content);
            if (parsed.choices?.[0]?.finish_reason === 'stop') { finish(); return; }
          } catch (_) {}
        }
      }
    } catch (err) {
      onError(`Stream error: ${err.message}`);
      return;
    }

    finish();
  }

  // Fetch available models from /v1/models.
  async fetchModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (data.data || []).map(m => m.id).sort();
  }
}

module.exports = LLMClient;
