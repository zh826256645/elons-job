const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createArea() {
  const values = {};
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(value, callback) { Object.assign(values, value); callback(); },
    remove(key, callback) { delete values[key]; callback(); }
  };
}

function createBackgroundHarness(harnessOptions = {}) {
  const local = createArea();
  const session = createArea();
  let messageListener;
  let installedListener;
  let startupListener;
  const requests = [];
  const profileRequests = [];
  const createdTabs = [];
  const notifications = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const chrome = {
    storage: { local, session },
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      onInstalled: { addListener(listener) { installedListener = listener; } },
      onStartup: { addListener(listener) { startupListener = listener; } },
      getURL(file) { return `chrome-extension://test/${file}`; },
      openOptionsPage() { return Promise.resolve(); }
    },
    tabs: {
      create(options) { createdTabs.push(options); return Promise.resolve(); },
      query() { return Promise.resolve([{ id: 1 }]); },
      sendMessage(tabId, message) { notifications.push({ tabId, message }); return Promise.resolve(); }
    }
  };
  const sandbox = {
    chrome,
    console,
    fetch: async (url, options) => {
      if (options.method === 'GET') {
        profileRequests.push({ url, options });
        return profileResponse(url, options);
      }
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      requests.push({ url, options, body: JSON.parse(options.body) });
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (options.body.includes('network-fail')) throw new TypeError('network failed');
        const body = JSON.parse(options.body);
        const answers = {};
        Object.keys(body.questions).forEach((id) => { answers[id] = { type: 'noul', noul: harnessOptions.scores ? harnessOptions.scores[id] || 0 : body.state.content === 'hide-me' ? (id === 'sexual_content' ? 0.93 : 0.12) : 0.08 }; });
        return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1, output_tokens: 1 } }) };
      } finally {
        activeRequests -= 1;
      }
    },
    performance,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Boolean,
    Array,
    Map,
    Set,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    URL
  };
  const profileResponse = harnessOptions.profileResponse || (async () => ({ ok: false, status: 403 }));
  vm.createContext(sandbox);
  const core = fs.readFileSync(path.join(__dirname, '..', 'src/shared/core.js'), 'utf8');
  sandbox.importScripts = () => vm.runInContext(core, sandbox);
  const background = fs.readFileSync(path.join(__dirname, '..', 'src/background.js'), 'utf8');
  vm.runInContext(background, sandbox);
  assert.equal(typeof messageListener, 'function');
  assert.equal(typeof installedListener, 'function');
  assert.equal(typeof startupListener, 'function');
  const dispatch = (message) => new Promise((resolve) => messageListener(message, {}, resolve));
  return { dispatch, requests, profileRequests, notifications, local, session, createdTabs, startupListener, get maxActiveRequests() { return maxActiveRequests; } };
}

test('local keywords hide without an API key, active AI rules, or profile requests', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness();
  const comment = { author: '女菩萨 @example', handle: 'example', text: '普通正文', hasMedia: true };
  const payload = { text: E.composeComment(comment), comment, scope: 'replies' };
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { rules: E.DEFAULT_RULES.map((rule) => ({ ...rule, enabled: false })) } });
  let result = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload });
  assert.equal(result.ok, true);
  assert.equal(result.shouldHide, true);
  assert.equal(result.matches[0].keyword, '女菩萨');
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  result = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload });
  assert.equal(result.shouldHide, true);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.profileRequests.length, 0);
  const state = await harness.dispatch({ type: E.MESSAGE.GET_STATE });
  assert.equal(state.stats.requests, 0);
});

test('local keyword decisions respect protection and scope switches', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness();
  const classify = (scope) => harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { text: '女菩萨', scope } });
  assert.equal((await classify('forYou')).shouldHide, false);
  assert.equal((await classify('replies')).shouldHide, true);
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { filterForYou: true, filterReplies: false } });
  assert.equal((await classify('forYou')).shouldHide, true);
  assert.equal((await classify('replies')).shouldHide, false);
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { enabled: false } });
  assert.equal((await classify('forYou')).shouldHide, false);
  assert.equal(harness.requests.length, 0);
});

test('keyword edits override cached AI results and deleting all words persists', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness();
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { blockedKeywords: [], dailyLimit: 1 } });
  const payload = { text: '女菩萨', scope: 'replies' };
  assert.equal((await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload })).shouldHide, false);
  assert.equal(harness.requests.length, 1);
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { blockedKeywords: ['女菩萨'] } });
  const blocked = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload });
  assert.equal(blocked.shouldHide, true);
  assert.equal(blocked.matches[0].source, 'local-keyword');
  assert.equal((await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { ...payload, force: true } })).shouldHide, true);
  assert.equal(harness.requests.length, 1);
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { blockedKeywords: [] } });
  assert.equal((await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload })).shouldHide, false);
  const state = await harness.dispatch({ type: E.MESSAGE.GET_STATE });
  assert.equal(state.config.blockedKeywords.length, 0);
});

test('keywords in newly fetched biographies hide before AI classification', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness({ profileResponse: async () => ({ ok: true, text: async () => '<script type="application/ld+json">{"@type":"Person","url":"https://x.com/example","description":"女菩萨"}</script>' }) });
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  const comment = { handle: 'example', author: 'Example', text: '', hasMedia: true };
  const result = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { comment, text: E.composeComment(comment), scope: 'replies' } });
  assert.equal(result.shouldHide, true);
  assert.equal(harness.profileRequests.length, 1);
  assert.equal(harness.requests.length, 0);
});

test('scope settings persist independently and notify X tabs without secret data', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness();
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { filterForYou: true, filterReplies: false } });
  const state = await harness.dispatch({ type: E.MESSAGE.GET_STATE });
  assert.equal(state.config.filterForYou, true);
  assert.equal(state.config.filterReplies, false);
  assert.deepEqual(harness.notifications.map((entry) => JSON.parse(JSON.stringify(entry))), [{ tabId: 1, message: { type: 'CONFIG_CHANGED' } }]);
});

test('oversized public profiles are cancelled and fall back to username evidence', async () => {
  const E = require('../src/shared/core.js');
  let cancelled = false;
  const harness = createBackgroundHarness({ profileResponse: async () => ({ ok: true, body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(524289) }),
    cancel: async () => { cancelled = true; },
    releaseLock() {}
  }) } }) });
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  const comment = { author: 'Example @example', handle: 'example', text: '' };
  const result = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { text: E.composeComment(comment), comment } });
  assert.equal(result.ok, true);
  assert.equal(cancelled, true);
  assert.equal(harness.requests[0].body.state.content, '[用户名] Example @example');
});

test('media-only classification supplements author evidence and caches public profiles', async () => {
  const E = require('../src/shared/core.js');
  const html = '<script type="application/ld+json">{"@type":"Person","url":"https://x.com/example","description":"公开作者简介"}</script>';
  const harness = createBackgroundHarness({ profileResponse: async () => ({ ok: true, text: async () => html }) });
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  const comment = { author: 'Example @example', handle: 'example', text: '' };
  const payload = { text: E.composeComment(comment), comment };
  const results = await Promise.all([harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload }), harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload })]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(harness.profileRequests.length, 1);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.requests[0].body.state.content, /\[作者公开简介\] 公开作者简介/);
  assert.equal(harness.profileRequests[0].url, 'https://x.com/example');
  assert.equal(harness.profileRequests[0].options.credentials, 'omit');
  assert.equal(harness.profileRequests[0].options.headers.Authorization, undefined);
  await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload });
  assert.equal(harness.profileRequests.length, 1);
  await harness.dispatch({ type: E.MESSAGE.CLEAR_CACHE });
  await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload });
  assert.equal(harness.profileRequests.length, 2);
});

test('unavailable public profiles fall back to usernames and are negatively cached', async () => {
  const E = require('../src/shared/core.js');
  for (const profileResponse of [
    async () => ({ ok: false, status: 403 }),
    async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); },
    async () => ({ ok: true, text: async () => '<html>Log in</html>' })
  ]) {
    const harness = createBackgroundHarness({ profileResponse });
    await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
    const comment = { author: 'Example @example', handle: 'example', text: '' };
    const payload = { text: E.composeComment(comment), comment };
    assert.equal((await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload })).ok, true);
    assert.equal(harness.requests[0].body.state.content, '[用户名] Example @example');
    await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload });
    assert.equal(harness.profileRequests.length, 1);
  }
});

test('For you enriches author biographies even when a media post has body text', async () => {
  const E = require('../src/shared/core.js');
  const html = '<script type="application/ld+json">{"@type":"Person","url":"https://x.com/example","description":"公开作者简介"}</script>';
  const harness = createBackgroundHarness({ profileResponse: async () => ({ ok: true, text: async () => html }) });
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { filterForYou: true } });
  const comment = { author: 'Example @example', handle: 'example', text: 'https://clips.example/movie.mp4', links: ['https://clips.example/movie.mp4'], hasMedia: true };
  const result = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { text: E.composeComment(comment), comment, scope: 'forYou' } });
  assert.equal(result.ok, true);
  assert.equal(harness.profileRequests.length, 1);
  assert.match(harness.requests[0].body.state.content, /\[作者公开简介\] 公开作者简介/);
  assert.match(harness.requests[0].body.state.content, /\[外链\]/);
  assert.equal('assets' in harness.requests[0].body, false);
});

test('link-only spam is blocked through the real pipeline in For you but keeps reply safeguards', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness({ scores: { sexual_content: 0.13, sexual_solicitation: 0.32, spam_behavior: 0.8 } });
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { filterForYou: true } });
  const comment = { author: 'Example @example', handle: 'example', text: 'https://clips.example/video.mp4', links: ['https://clips.example/video.mp4'], hasMedia: true };
  const payload = { text: E.composeComment(comment), comment };
  const forYou = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { ...payload, scope: 'forYou' } });
  const reply = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { ...payload, scope: 'replies' } });
  assert.equal(forYou.shouldHide, true);
  assert.equal(forYou.matches[0].ruleId, 'spam_behavior');
  assert.equal(reply.shouldHide, false);
  const cached = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { ...payload, scope: 'forYou' } });
  assert.equal(cached.cache, 'hit');
  assert.equal(cached.shouldHide, true);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.profileRequests.length, 1);
  assert.ok(harness.requests.every((request) => !('assets' in request.body)));
});

test('disabled scopes do not issue classification requests', async () => {
  const E = require('../src/shared/core.js');
  const harness = createBackgroundHarness();
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  const result = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { text: 'hide-me', scope: 'forYou' } });
  assert.equal(result.shouldHide, false);
  assert.equal(harness.requests.length, 0);
});

test('background pipeline keeps the API key out of the request body, caches duplicates, and fails open', async () => {
  const harness = createBackgroundHarness();
  const E = require('../src/shared/core.js');
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  const first = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { tweetId: 'reply-1', text: 'hide-me' } });
  assert.equal(first.ok, true);
  assert.equal(first.shouldHide, true);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.requests[0].options.headers.Authorization, /^Bearer apikey_secret$/);
  assert.equal(harness.requests[0].body.state.content, 'hide-me');
  assert.equal(JSON.stringify(harness.requests[0].body).includes('apikey_secret'), false);

  const cached = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { tweetId: 'reply-2', text: 'hide-me' } });
  assert.equal(cached.ok, true);
  assert.equal(cached.cache, 'hit');
  assert.equal(harness.requests.length, 1);

  const rechecked = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { tweetId: 'reply-2', text: 'hide-me', force: true } });
  assert.equal(rechecked.ok, true);
  assert.equal(rechecked.cache, 'miss');
  assert.equal(harness.requests.length, 2);

  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { dailyLimit: 1 } });
  const limited = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { tweetId: 'reply-3', text: 'another safe comment' } });
  assert.equal(limited.ok, false);
  assert.equal(limited.error, 'DAILY_LIMIT_REACHED');

  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { dailyLimit: 2000 } });
  const failed = await harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { tweetId: 'reply-4', text: 'network-fail' } });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'API_UNAVAILABLE');
  assert.equal(failed.shouldHide, undefined);
});

test('background queue never exceeds the configured concurrency', async () => {
  const harness = createBackgroundHarness();
  const E = require('../src/shared/core.js');
  await harness.dispatch({ type: E.MESSAGE.SAVE_API_KEY, payload: { apiKey: 'apikey_secret' } });
  await harness.dispatch({ type: E.MESSAGE.SAVE_CONFIG, payload: { maxConcurrency: 2 } });
  const results = await Promise.all(Array.from({ length: 7 }, (_, index) => harness.dispatch({ type: E.MESSAGE.CLASSIFY_COMMENT, payload: { tweetId: `reply-${index}`, text: `safe-${index}` } })));
  assert.ok(results.every((result) => result.ok));
  assert.ok(harness.maxActiveRequests <= 2, `observed ${harness.maxActiveRequests} concurrent requests`);
});

test('unconfigured startup opens the onboarding page as a fallback', async () => {
  const harness = createBackgroundHarness();
  await harness.startupListener();
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].url, 'chrome-extension://test/src/onboarding.html');
});

test('comment totals accumulate across pages independently from page metrics', async () => {
  const harness = createBackgroundHarness();
  const E = require('../src/shared/core.js');
  await harness.dispatch({ type: E.MESSAGE.RECORD_COMMENT_EVENT, payload: { action: 'checked', page: { checked: 1, hidden: 0 } } });
  await harness.dispatch({ type: E.MESSAGE.RECORD_COMMENT_EVENT, payload: { action: 'hidden', page: { checked: 1, hidden: 1 } } });
  const state = await harness.dispatch({ type: E.MESSAGE.GET_STATE });
  assert.equal(state.stats.totalChecked, 1);
  assert.equal(state.stats.totalHidden, 1);
  assert.equal(state.stats.pageChecked, 1);
  assert.equal(state.stats.pageHidden, 1);
});
