'use strict';

// OpenAI-compatible LLM client.
// Works with Ollama, LM Studio, llama.cpp server, vLLM, LocalAI, OpenAI, etc.
// When useResponsesAPI=true, uses /v1/responses (required for OpenAI Codex models).
class LLMClient {
  constructor(baseUrl, model, authToken = null, useResponsesAPI = false, responsesPath = '/v1/responses') {
    this.baseUrl         = baseUrl.replace(/\/$/, '');
    this.model           = model;
    this.authToken       = authToken;       // Bearer token; null for unauthenticated local endpoints
    this.useResponsesAPI = useResponsesAPI; // true for OpenAI Codex flow
    this.responsesPath   = responsesPath;   // allows ChatGPT Codex backend path
  }

  _buildHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  async chat(systemPrompt, userMessage, onChunk, onDone, onError) {
    if (this.useResponsesAPI) {
      return this._chatViaResponsesAPI(systemPrompt, userMessage, onChunk, onDone, onError);
    }
    return this._chatViaCompletions(systemPrompt, userMessage, onChunk, onDone, onError);
  }

  // Stream via POST /v1/chat/completions (local endpoints, vLLM, etc.)
  async _chatViaCompletions(systemPrompt, userMessage, onChunk, onDone, onError) {
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
        headers: this._buildHeaders(),
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

    const finish = () => { if (!finished) { finished = true; onDone(); } };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

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

  // Stream via POST Responses API endpoint.
  // SSE events use named event types; text arrives in `response.output_text.delta`.
  async _chatViaResponsesAPI(systemPrompt, userMessage, onChunk, onDone, onError) {
    const body = JSON.stringify({
      model:        this.model,
      instructions: systemPrompt,
      input:        [{ role: 'user', content: userMessage }],
      stream:       true,
      store:        false
    });

    let response;
    try {
      response = await fetch(`${this.baseUrl}${this.responsesPath}`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body
      });
    } catch (err) {
      onError(`Cannot connect to OpenAI.\nError: ${err.message}`);
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
    let currentEvent = '';

    const finish = () => { if (!finished) { finished = true; onDone(); } };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = ''; // blank line ends an SSE event block
            continue;
          }
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') { finish(); return; }

          if (currentEvent === 'response.output_text.delta') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.delta) onChunk(parsed.delta);
            } catch (_) {}
          } else if (currentEvent === 'response.completed' || currentEvent === 'response.failed') {
            finish();
            return;
          }
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
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this._buildHeaders()
    });
    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch (_) {}
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    return (data.data || []).map(m => m.id).sort();
  }
}

module.exports = LLMClient;
