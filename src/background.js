importScripts('shared/core.js');

(function () {
  'use strict';

  const E = globalThis.ElonsWork;
  const runtime = globalThis.chrome;
  let reservedRequests = 0;
  let quotaGate = Promise.resolve();
  let statsGate = Promise.resolve();

  async function writeStats(changes) {
    const previous = statsGate;
    let release;
    statsGate = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const current = await E.getStats(runtime);
      const next = { ...(changes || {}) };
      for (const key of ['requests', 'cacheHits', 'errors', 'checked', 'hidden']) {
        const deltaKey = `${key}Delta`;
        if (Object.prototype.hasOwnProperty.call(next, deltaKey)) {
          const delta = Number(next[deltaKey] || 0);
          next[key] = current[key] + delta;
          if (key === 'checked') next.totalChecked = current.totalChecked + delta;
          if (key === 'hidden') next.totalHidden = current.totalHidden + delta;
          delete next[deltaKey];
        }
      }
      return await E.updateStats(runtime, next);
    } finally {
      release();
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function withTimeoutSignal(milliseconds) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), milliseconds);
    return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
  }

  class TypeSafeClient {
    constructor(endpoint, model) {
      this.endpoint = endpoint || E.API_ENDPOINT;
      this.model = model || E.MODEL_VERSION;
    }

    async request(apiKey, body, options) {
      if (!apiKey) throw Object.assign(new Error('API key is missing'), { code: 'API_KEY_MISSING' });
      const config = options || {};
      const attempts = Number(config.attempts) || 2;
      let lastError;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const timeout = withTimeoutSignal(Number(config.timeoutMs) || 12000);
        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ model: this.model, ...body }),
            signal: timeout.signal
          });
          const text = await response.text();
          let data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
          if (response.ok) return data;
          const error = Object.assign(new Error(`TypeSafe request failed (${response.status})`), { status: response.status, data });
          if (response.status === 401 || response.status === 403) throw error;
          lastError = error;
          if (response.status !== 429 && response.status < 500) throw error;
          await delay(response.status === 429 ? 350 * (attempt + 1) : 200 * (attempt + 1));
        } catch (error) {
          lastError = error;
          const code = E.cleanError(error);
          if (code === 'API_KEY_INVALID') throw error;
          const status = Number(error && error.status);
          const retryable = !status || status === 429 || status >= 500 || (error && error.name === 'AbortError');
          if (!retryable) throw error;
          if (attempt + 1 < attempts) await delay(180 * (attempt + 1));
        } finally {
          timeout.dispose();
        }
      }
      throw lastError || Object.assign(new Error('TypeSafe unavailable'), { code: 'API_UNAVAILABLE' });
    }

    async testConnection(apiKey) {
      const started = performance.now();
      await this.request(apiKey, {
        state: { content: 'connection test' },
        questions: {
          connection_ok: {
            type: 'noul',
            instructions: 'Is this a connection test?',
            criteria: { true: 'The request is a connection test.', false: 'The request is not a connection test.' }
          }
        }
      }, { attempts: 1, timeoutMs: 10000 });
      return Math.round(performance.now() - started);
    }

    async classify(apiKey, questions, content) {
      const started = performance.now();
      const response = await this.request(apiKey, {
        state: { content },
        questions
      }, { attempts: 2, timeoutMs: 12000 });
      return { response, latencyMs: Math.round(performance.now() - started) };
    }
  }

  class RequestQueue {
    constructor(concurrency) {
      this.concurrency = Math.max(1, Number(concurrency) || 3);
      this.active = 0;
      this.pending = [];
      this.inFlight = new Map();
    }

    setConcurrency(value) {
      this.concurrency = Math.max(1, Math.min(8, Number(value) || 3));
      this.pump();
    }

    get(key) {
      return this.inFlight.get(key) || null;
    }

    enqueue(key, task) {
      if (this.inFlight.has(key)) return this.inFlight.get(key);
      const promise = new Promise((resolve, reject) => {
        this.pending.push({ key, task, resolve, reject });
        this.pump();
      });
      this.inFlight.set(key, promise);
      promise.then(() => this.inFlight.delete(key), () => this.inFlight.delete(key));
      return promise;
    }

    pump() {
      while (this.active < this.concurrency && this.pending.length) {
        const item = this.pending.shift();
        this.active += 1;
        Promise.resolve()
          .then(item.task)
          .then(item.resolve, item.reject)
          .finally(() => {
            this.active -= 1;
            this.pump();
          });
      }
    }
  }

  const queue = new RequestQueue(3);
  const profileQueue = new RequestQueue(2);
  const PROFILE_CACHE_KEY = 'elonsWorkProfiles';
  let profileWrites = Promise.resolve();

  async function authorBiography(rawHandle) {
    const handle = E.normalizeHandle(rawHandle);
    if (!handle) return '';
    const stored = await E.storageGet(runtime, 'session', PROFILE_CACHE_KEY);
    const cached = (stored[PROFILE_CACHE_KEY] || {})[handle];
    if (cached && Date.now() < cached.expiresAt) return cached.biography;
    return profileQueue.enqueue(handle, async () => {
      const timeout = withTimeoutSignal(2500);
      let biography = '';
      try {
        const response = await fetch(`https://x.com/${handle}`, {
          method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: { Accept: 'text/html' }, signal: timeout.signal
        });
        if (response.ok) {
          let html = '';
          // Bound the response while streaming, rather than retaining a whole
          // unexpectedly large page before checking its size.
          if (response.body && response.body.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let size = 0;
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 524288) { await reader.cancel(); html = ''; break; }
                html += decoder.decode(chunk.value, { stream: true });
              }
              html += decoder.decode();
            } finally { reader.releaseLock(); }
          } else {
            html = await response.text();
          }
          biography = E.profileBiography(html, handle);
        }
      } catch (_) { /* Public profiles can be unavailable; classification continues. */ }
      finally { timeout.dispose(); }
      profileWrites = profileWrites.then(async () => {
        const latest = await E.storageGet(runtime, 'session', PROFILE_CACHE_KEY);
        const entries = Object.entries(latest[PROFILE_CACHE_KEY] || {}).filter(([key, value]) => key !== handle && Date.now() < value.expiresAt);
        entries.push([handle, { biography, expiresAt: Date.now() + (biography ? 86400000 : 600000) }]);
        await E.storageSet(runtime, 'session', { [PROFILE_CACHE_KEY]: Object.fromEntries(entries.slice(-200)) });
      });
      await profileWrites;
      return biography;
    });
  }

  async function openOnboarding() {
    await runtime.tabs.create({ url: runtime.runtime.getURL('src/onboarding.html') });
    return { ok: true };
  }

  async function reserveRequest(limit) {
    let release;
    const previous = quotaGate;
    quotaGate = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const stats = await E.getStats(runtime);
      if (stats.requests + reservedRequests >= limit) return false;
      reservedRequests += 1;
      await writeStats({ requestsDelta: 1 });
      return true;
    } finally {
      release();
    }
  }

  async function cacheGet(key) {
    const stored = await E.storageGet(runtime, 'session', E.CACHE_KEY);
    const cache = stored[E.CACHE_KEY] || {};
    return cache[key] || null;
  }

  async function cacheSet(key, value) {
    const stored = await E.storageGet(runtime, 'session', E.CACHE_KEY);
    const cache = stored[E.CACHE_KEY] || {};
    const entries = Object.entries({ ...cache, [key]: value });
    const bounded = Object.fromEntries(entries.slice(-500));
    await E.storageSet(runtime, 'session', { [E.CACHE_KEY]: bounded });
  }

  async function classify(payload) {
    const config = await E.loadConfig(runtime, true);
    const rules = E.activeRules(config);
    let text = E.normalizeText(payload && payload.text);
    if (!config.enabled || !rules.length) return { ok: true, shouldHide: false, matches: [], results: {} };
    if (payload && payload.scope && !E.scopeEnabled(config, payload.scope)) return { ok: true, shouldHide: false, matches: [], results: {} };
    if (!text || text.length < 2) return { ok: true, shouldHide: false, matches: [], results: {} };
    if (!config.typesafeApiKey) return { ok: false, error: 'API_KEY_MISSING' };

    // For you and media replies need author context even when their body is a
    // short caption or URL. Public-profile failures never stop classification.
    const comment = payload && payload.comment;
    if (comment && E.normalizeHandle(comment.handle) && (payload.scope === 'forYou' || comment.hasMedia || !comment.text)) {
      const biography = await authorBiography(comment.handle);
      text = E.normalizeText(E.composeComment({ ...comment, biography }));
    }
    if (payload.scope === 'forYou') text = E.normalizeText(`[过滤范围] X 首页 For you 推荐帖子\n${text}`);

    const key = await E.cacheKey(text, rules, config.model, payload && payload.scope);
    const force = payload && payload.force === true;
    const cached = force ? null : await cacheGet(key);
    if (!force && cached && Date.now() - cached.createdAt < config.cacheTtlHours * 60 * 60 * 1000) {
      await writeStats({ cacheHitsDelta: 1 });
      return { ok: true, ...cached.decision, cache: 'hit' };
    }

    queue.setConcurrency(config.maxConcurrency);
    const requestKey = `${payload.scope || ''}:${key}`;
    const existing = queue.get(requestKey);
    if (existing) return existing;
    const fingerprint = await E.rulesFingerprint(rules);
    const questions = E.buildQuestions(rules);
    const client = new TypeSafeClient(config.apiEndpoint, config.model);
    const queued = queue.enqueue(requestKey, async () => {
      const currentConfig = await E.loadConfig(runtime, false);
      if (!currentConfig.enabled || (payload.scope && !E.scopeEnabled(currentConfig, payload.scope))) return { ok: true, shouldHide: false, matches: [], results: {} };
      const reserved = await reserveRequest(config.dailyLimit);
      if (!reserved) return { ok: false, error: 'DAILY_LIMIT_REACHED' };
      try {
        const result = await client.classify(config.typesafeApiKey, questions, text);
        const decision = E.buildDecision(result.response, rules, { content: text, scope: payload.scope, linkEvidence: E.linkEvidence(comment) });
        await cacheSet(key, { createdAt: Date.now(), model: config.model, fingerprint, decision });
        await writeStats({ latencyMs: result.latencyMs, lastError: '' });
        E.debugLog(config, 'classified', { tweetId: payload && payload.tweetId, contentHash: key, latencyMs: result.latencyMs, cache: 'miss' });
        return { ok: true, ...decision, latencyMs: result.latencyMs, cache: 'miss' };
      } catch (error) {
        const code = E.cleanError(error);
        await writeStats({ errorsDelta: 1, lastError: code });
        E.debugLog(config, 'classification_error', { tweetId: payload && payload.tweetId, contentHash: key, error: code });
        return { ok: false, error: code };
      } finally {
        reservedRequests = Math.max(0, reservedRequests - 1);
      }
    });
    return queued;
  }

  async function state() {
    const config = await E.loadConfig(runtime, true);
    const stats = await E.getStats(runtime);
    return {
      config: E.sanitizeConfig(config),
      hasApiKey: Boolean(config.typesafeApiKey),
      needsOnboarding: !config.typesafeApiKey && config.onboardingCompleted !== true,
      apiKeyMask: E.maskSecret(config.typesafeApiKey),
      stats
    };
  }

  async function notifyConfigChanged() {
    try {
      const tabs = await runtime.tabs.query({ url: 'https://x.com/*' });
      await Promise.allSettled(tabs.map((tab) => runtime.tabs.sendMessage(tab.id, { type: E.MESSAGE.CONFIG_CHANGED })));
    } catch (_) { /* Closed tabs and unavailable receivers are harmless. */ }
  }

  async function handleMessage(message) {
    const type = message && message.type;
    const payload = message && message.payload;
    if (type === E.MESSAGE.GET_STATE) return { ok: true, ...(await state()) };
    if (type === E.MESSAGE.SAVE_API_KEY) {
      const apiKey = String(payload && payload.apiKey || '').trim();
      if (apiKey.length > 512) return { ok: false, error: 'API_KEY_INVALID_FORMAT' };
      await E.saveConfig(runtime, { typesafeApiKey: apiKey });
      await notifyConfigChanged();
      return { ok: true, hasApiKey: Boolean(apiKey), apiKeyMask: E.maskSecret(apiKey) };
    }
    if (type === E.MESSAGE.TEST_CONNECTION) {
      const config = await E.loadConfig(runtime, true);
      const apiKey = String(payload && payload.apiKey || config.typesafeApiKey || '').trim();
      if (!apiKey) return { ok: false, error: 'API_KEY_MISSING' };
      try {
        const latencyMs = await new TypeSafeClient(config.apiEndpoint, config.model).testConnection(apiKey);
        return { ok: true, latencyMs };
      } catch (error) {
        return { ok: false, error: E.cleanError(error) };
      }
    }
    if (type === E.MESSAGE.OPEN_ONBOARDING) return openOnboarding();
    if (type === E.MESSAGE.CLASSIFY_COMMENT) return classify(payload || {});
    if (type === E.MESSAGE.SAVE_CONFIG) {
      const saved = await E.saveConfig(runtime, payload || {});
      await notifyConfigChanged();
      return { ok: true, config: E.sanitizeConfig(saved) };
    }
    if (type === E.MESSAGE.RECORD_COMMENT_EVENT) {
      const action = String(payload && payload.action || '');
      const page = payload && payload.page;
      const changes = {};
      if (action === 'checked') changes.checkedDelta = 1;
      if (action === 'hidden') changes.hiddenDelta = 1;
      if (page && Number.isFinite(page.checked)) changes.pageChecked = Math.max(0, Number(page.checked));
      if (page && Number.isFinite(page.hidden)) changes.pageHidden = Math.max(0, Number(page.hidden));
      if (page && Number.isFinite(page.safe)) changes.pageSafe = Math.max(0, Number(page.safe));
      if (page && Number.isFinite(page.pending)) changes.pagePending = Math.max(0, Number(page.pending));
      if (page && Number.isFinite(page.errors)) changes.pageErrors = Math.max(0, Number(page.errors));
      if (page && Number.isFinite(page.latencyMs)) changes.pageLatencyMs = Math.max(0, Number(page.latencyMs));
      await writeStats(changes);
      return { ok: true };
    }
    if (type === E.MESSAGE.CLEAR_CACHE) {
      await E.storageRemove(runtime, 'session', E.CACHE_KEY);
      await E.storageRemove(runtime, 'local', E.CACHE_KEY);
      await profileWrites;
      await E.storageRemove(runtime, 'session', PROFILE_CACHE_KEY);
      return { ok: true };
    }
    if (type === E.MESSAGE.OPEN_SETTINGS) {
      await runtime.runtime.openOptionsPage();
      return { ok: true };
    }
    return { ok: false, error: 'UNKNOWN_MESSAGE' };
  }

  runtime.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: E.cleanError(error) }));
    return true;
  });

  runtime.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      await E.saveConfig(runtime, E.createDefaultConfig());
      await openOnboarding();
      return;
    }
    if (details.reason === 'update') {
      const config = await E.loadConfig(runtime, true);
      if (!config.typesafeApiKey && config.onboardingCompleted !== true) await openOnboarding();
    }
  });

  runtime.runtime.onStartup.addListener(async () => {
    const config = await E.loadConfig(runtime, true);
    if (!config.typesafeApiKey && config.onboardingCompleted !== true) await openOnboarding();
  });
})();
