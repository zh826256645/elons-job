const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/shared/core.js');

test('keyword defaults migrate once and respect a deleted or empty blacklist', () => {
  assert.deepEqual(E.createDefaultConfig().blockedKeywords, ['女菩萨']);
  assert.deepEqual(E.normalizeConfig({ rulesVersion: 3 }).blockedKeywords, ['女菩萨']);
  assert.deepEqual(E.normalizeConfig({ blockedKeywords: [] }).blockedKeywords, []);
  assert.deepEqual(E.normalizeConfig({ blockedKeywords: [' other ', 'OTHER', '', null, 123, '\u200b', '女\u200b菩萨'] }).blockedKeywords, ['other', '女菩萨']);
});

test('keyword matching uses literal source fields with Unicode and case normalization', () => {
  for (const field of ['author', 'username', 'handle', 'text', 'biography', 'cardText']) {
    const decision = E.localKeywordDecision({ [field]: '今天的女\u200b菩萨来了' }, ['女菩萨']);
    assert.equal(decision.shouldHide, true, field);
    assert.equal(decision.matches[0].keyword, '女菩萨');
    assert.equal(decision.matches[0].source, 'local-keyword');
    assert.equal(decision.matches[0].probability, undefined);
  }
  assert.equal(E.localKeywordDecision({ links: ['https://example.com/SPAM'] }, ['spam']).shouldHide, true);
  assert.equal(E.localKeywordDecision({ text: 'ＡＤＵＬＴ' }, ['adult']).shouldHide, true);
  assert.equal(E.localKeywordDecision({ text: 'anything' }, ['.*']).shouldHide, false);
  assert.equal(E.localKeywordDecision({ text: '女菩萨' }, []).shouldHide, false);
  assert.equal(E.localKeywordDecision({ author: '普通用户', text: '正常讨论' }, ['用户名', '评论正文']).shouldHide, false);
  assert.equal(E.localKeywordDecision({ author: '女', text: '菩萨' }, ['女菩萨']).shouldHide, false);
  assert.equal(E.localKeywordDecision({ text: 'x'.repeat(4000) + '女菩萨' }, ['女菩萨']).shouldHide, true);
});

test('default configuration exposes three enabled builtin rules', () => {
  const config = E.createDefaultConfig();
  assert.equal(config.rules.length, 3);
  assert.deepEqual(config.rules.map((rule) => rule.id), ['sexual_content', 'sexual_solicitation', 'spam_behavior']);
  assert.ok(config.rules[0].enabled && config.rules[0].builtin && config.rules[0].threshold === 0.65);
  assert.ok(config.rules[1].enabled && config.rules[1].builtin && config.rules[1].threshold === 0.75);
  assert.equal(config.rules[2].threshold, 0.78);
  assert.equal(config.showCheckControls, true);
  assert.equal(config.dailyLimit, 100000);
  assert.equal(E.activeRules(config).length, 3);
});

test('migrates the legacy default daily limit to 100000', () => {
  const config = E.normalizeConfig({ rulesVersion: 2, dailyLimit: 2000 });
  assert.equal(config.rulesVersion, 3);
  assert.equal(config.dailyLimit, 100000);
  assert.equal(E.normalizeConfig({ rulesVersion: 3, dailyLimit: 2000 }).dailyLimit, 2000);
});

test('normalizeText removes zero-width characters and whitespace only while preserving signals', () => {
  const source = '  骚\u200b🖤❤️  1789699386154\nhttps://x.com/a  ';
  assert.equal(E.normalizeText(source), '骚🖤❤️ 1789699386154 https://x.com/a');
});

test('normalizeText removes the broader invisible-character table', () => {
  const dirty = '\u200d比\u2060\u2060\u200c\u2060\u2060我\u200d\u2060\u200c\u200c\u200d好\u200c\u200d\u200c\u2060\u200c\u200c的\u200c\u2060\u200c\u2060\u200d没\u200d\u200d\u2060\u200d\u200c我\u200c\u200d骚\u2060\u2060\u2060\u2060\u200c\u2060\u200d😟\u200c\u200c\u200c\u2060比\u200c\u200c\u2060\u200c\u2060\u200c\u200d我\u200d\u200d\u2060骚\u200d\u200d\u200d\u200c\u200c的\u200c\u2060\u200d\u200d没\u200c\u200c\u2060我\u200c\u200c\u200d\u200c好\u200c\u200c\u200d看\u200c\u200c\u2060\u200c🌀\u2060\u200c';
  assert.equal(E.normalizeText(dirty), '比我好的没我骚😟比我骚的没我好看🌀');
});

test('comment extraction and TypeSafe content include the display name and handle', () => {
  const article = {
    querySelector(selector) {
      if (selector.includes('/status/')) return { getAttribute: () => '/someone/status/123' };
      if (selector.includes('tweetText')) return { textContent: '恭喜发财，祝你有美好的一天' };
      if (selector.includes('User-Name')) return { textContent: '卫潼笑♥处男免费♥ @example' };
      return null;
    }
  };
  const comment = E.extractComment(article);
  assert.deepEqual(comment, { tweetId: '123', text: '恭喜发财，祝你有美好的一天', author: '卫潼笑♥处男免费♥ @example', handle: 'example', keywordFields: ['卫潼笑♥处男免费♥ @example', 'example', '恭喜发财，祝你有美好的一天'] });
  const composed = E.composeComment(comment);
  assert.match(composed, /\[用户名\] 卫潼笑♥处男免费♥ @example/);
  assert.match(composed, /\[评论正文\] 恭喜发财，祝你有美好的一天/);
  assert.match(composed, /username_emoji_count=2/);
  assert.match(composed, /body_emoji_count=0/);
});

test('buildQuestions compiles enabled rules into Jev noul questions', () => {
  const questions = E.buildQuestions(E.DEFAULT_RULES);
  assert.equal(questions.sexual_content.type, 'noul');
  assert.match(questions.sexual_content.instructions, /性暗示/);
  assert.match(questions.sexual_content.instructions, /用户名/);
  assert.match(questions.sexual_content.instructions, /emoji/);
  assert.match(questions.sexual_solicitation.instructions, /用户名/);
  assert.equal(questions.spam_behavior.type, 'noul');
  assert.match(questions.spam_behavior.instructions, /模板刷屏/);
  assert.equal(questions.sexual_content.criteria.false.length > 0, true);
});

test('config upgrades persisted builtin rules while preserving user threshold and enabled state', () => {
  const config = E.normalizeConfig({ rules: [{ ...E.DEFAULT_RULES[0], instructions: 'old prompt', threshold: 0.91, enabled: false }, { ...E.DEFAULT_RULES[1], threshold: 0.8 }] });
  assert.match(config.rules[0].instructions, /emoji/);
  assert.equal(config.rules[0].threshold, 0.91);
  assert.equal(config.rules[0].enabled, false);
  assert.equal(config.rules[1].threshold, 0.75);
});

test('decision uses pTrue/noul probabilities and local thresholds', () => {
  const rules = [
    { id: 'a', name: 'A', threshold: 0.8, enabled: true },
    { id: 'b', name: 'B', threshold: 0.8, enabled: true },
    { id: 'c', name: 'C', threshold: 0.8, enabled: true }
  ];
  const result = E.buildDecision({ answers: { a: { noul: 0.93 }, b: { pTrue: 0.79 }, c: { probabilities: { true: 0.81 } } } }, rules);
  assert.equal(result.shouldHide, true);
  assert.deepEqual(result.matches.map((item) => item.ruleId), ['a', 'c']);
  assert.equal(result.results.b, 0.79);
});

test('repeated emoji template forces the spam rule into the hide decision', () => {
  const spamRule = E.DEFAULT_RULES.find((rule) => rule.id === 'spam_behavior');
  const content = E.composeComment({ username: 'A @a', text: '恭喜发财🍭 Respectful，祝福你有美好的一天', templateCount: 3 });
  const result = E.buildDecision({ answers: { spam_behavior: { noul: 0.12 } } }, [spamRule], { content });
  assert.equal(result.localSignals.spam.matched, true);
  assert.equal(result.shouldHide, true);
  assert.equal(result.matches[0].ruleId, 'spam_behavior');
  assert.equal(result.matches[0].source, 'page-template-signal');
});

test('emoji substitutions share one page template fingerprint', () => {
  assert.equal(
    E.templateFingerprint('没人比我玩的开了吧🐼我福不黑不信你看🐵'),
    E.templateFingerprint('没人比我玩的开了吧🍂我福不黑不信你看⛺')
  );
});

test('emoji variation selectors do not split equivalent templates', () => {
  assert.equal(
    E.templateFingerprint('没人比我玩的开了吧🐼我福不黑不信你看🐵'),
    E.templateFingerprint('没人比我玩的开了吧🏙️🦐我福不黑不信你看')
  );
});

test('spam score alone does not hide a plain single comment', () => {
  const spamRule = E.DEFAULT_RULES.find((rule) => rule.id === 'spam_behavior');
  const result = E.buildDecision({ answers: { spam_behavior: { noul: 0.99 } } }, [spamRule], { content: '我发的不是普通内容，想看完整版就进群。' });
  assert.equal(result.shouldHide, false);
});

test('spam model does not hide a plain repeated template without emoji structure', () => {
  const spamRule = E.DEFAULT_RULES.find((rule) => rule.id === 'spam_behavior');
  const content = E.composeComment({ text: '恭喜发财，祝福你有美好的一天。', templateCount: 4 });
  const result = E.buildDecision({ answers: { spam_behavior: { noul: 0.99 } } }, [spamRule], { content });
  assert.equal(result.localSignals.spam.templateMatches, 4);
  assert.equal(result.localSignals.spam.matched, false);
  assert.equal(result.shouldHide, false);
});

test('emoji cluster structure catches a single suspicious template with moderate model support', () => {
  const spamRule = E.DEFAULT_RULES.find((rule) => rule.id === 'spam_behavior');
  const content = E.composeComment({ text: '应该没人比我玩的开了吧🌺🙂我福不黑不信你看' });
  const result = E.buildDecision({ answers: {
    sexual_content: { noul: 0.48 },
    sexual_solicitation: { noul: 0.06 },
    spam_behavior: { noul: 0.20 }
  } }, [spamRule, E.DEFAULT_RULES[0], E.DEFAULT_RULES[1]], { content });
  assert.equal(result.localSignals.spam.emojiClusterTemplate, true);
  assert.equal(result.shouldHide, true);
  assert.equal(result.matches.some((match) => match.source === 'emoji-cluster-signal'), true);
});

test('natural emoji-separated prose does not trigger the single-comment spam signal', () => {
  const content = E.composeComment({ text: '今天的晚霞真漂亮🌇，回家路上听了喜欢的歌🎧。' });
  const result = E.buildDecision({ answers: {
    sexual_content: { noul: 0.48 },
    sexual_solicitation: { noul: 0.06 },
    spam_behavior: { noul: 0.20 }
  } }, E.DEFAULT_RULES, { content });
  assert.equal(result.localSignals.spam.emojiClusterTemplate, false);
  assert.equal(result.shouldHide, false);
});

test('invisible-character pollution is a spam signal after the text is cleaned', () => {
  const spamRule = E.DEFAULT_RULES.find((rule) => rule.id === 'spam_behavior');
  const dirty = '\u200d比\u2060我\u200c骚😟\u2060比\u200d我骚🌀';
  const content = E.composeComment({ text: dirty });
  const result = E.buildDecision({ answers: { spam_behavior: { noul: 0.1 } } }, [spamRule], { content });
  assert.match(content, /invisible_char_count=5/);
  assert.match(content, /比我骚😟比我骚🌀/);
  assert.equal(result.localSignals.spam.matched, true);
  assert.equal(result.shouldHide, true);
});

test('emoji-obfuscated representative sexual phrase forces the sexual rule', () => {
  const sexualRule = E.DEFAULT_RULES.find((rule) => rule.id === 'sexual_content');
  const content = E.composeComment({ username: '有腿🔥 @a', text: '是💼这个出处吧🚀啊啊小马开🍀大车!', templateCount: 0 });
  const result = E.buildDecision({ answers: { sexual_content: { noul: 0.43 } } }, [sexualRule], { content });
  assert.equal(result.localSignals.sexualObfuscation.matched, true);
  assert.equal(result.shouldHide, true);
  assert.equal(result.matches[0].source, 'emoji-obfuscation-signal');
});

test('combined builtin risk hides multiple moderate signals', () => {
  const result = E.buildDecision({ answers: {
    sexual_content: { noul: 0.57 },
    sexual_solicitation: { noul: 0.13 },
    spam_behavior: { noul: 0.41 }
  } }, E.DEFAULT_RULES, { content: E.composeComment({ text: '那一夜你☝没有拒绝我🔥😍不是人机 - L' }) });
  assert.ok(Math.abs(result.combinedRisk.score - 1.11) < 1e-9);
  assert.deepEqual(result.combinedRisk.qualifyingRuleIds, ['sexual_content', 'spam_behavior']);
  assert.equal(result.combinedRisk.matched, true);
  assert.equal(result.matches.some((match) => match.source === 'combined-risk-signal'), true);
  assert.equal(result.shouldHide, true);
});

test('combined builtin risk does not hide one moderate signal', () => {
  const result = E.buildDecision({ answers: {
    sexual_content: { noul: 0.57 },
    sexual_solicitation: { noul: 0.13 },
    spam_behavior: { noul: 0.39 }
  } }, E.DEFAULT_RULES, { content: E.composeComment({ text: '那一夜你☝没有拒绝我🔥😍不是人机 - L' }) });
  assert.equal(result.combinedRisk.matched, false);
});

test('combined builtin risk ignores ordinary no-emoji model overlap', () => {
  const result = E.buildDecision({ answers: {
    sexual_content: { noul: 0.44 },
    sexual_solicitation: { noul: 0.67 },
    spam_behavior: { noul: 0.79 }
  } }, E.DEFAULT_RULES, { content: E.composeComment({ text: '我发的不是普通内容，想看完整版就进群。' }) });
  assert.equal(result.combinedRisk.structuralSupport, false);
  assert.equal(result.combinedRisk.matched, false);
  assert.equal(result.shouldHide, false);
});

test('disabled rules never produce a match', () => {
  const result = E.buildDecision({ answers: { muted: { noul: 1 } } }, [{ id: 'muted', name: 'Muted', threshold: 0.5, enabled: false }]);
  assert.equal(result.shouldHide, false);
  assert.deepEqual(result.matches, []);
});

test('cache key changes with normalized content, rule instructions, or model but not threshold', async () => {
  const base = [{ id: 'rule', instructions: 'same', trueCriteria: 'yes', falseCriteria: 'no', threshold: 0.8, enabled: true }];
  const thresholdOnly = [{ ...base[0], threshold: 0.9 }];
  const instructionChange = [{ ...base[0], instructions: 'changed' }];
  assert.equal(await E.cacheKey(' hello ', base, 'jev-latest'), await E.cacheKey('hello', thresholdOnly, 'jev-latest'));
  assert.notEqual(await E.cacheKey('hello', base, 'jev-latest'), await E.cacheKey('hello', instructionChange, 'jev-latest'));
  assert.notEqual(await E.cacheKey('hello', base, 'jev-latest'), await E.cacheKey('hello', base, 'jev-next'));
});

test('X scope recognises only detail URLs and skips the root tweet', () => {
  const url = 'https://x.com/elonmusk/status/123456789?x=1';
  assert.equal(E.isTweetDetailUrl(url), true);
  assert.equal(E.rootTweetId(url), '123456789');
  assert.equal(E.isTweetDetailUrl('https://x.com/home'), false);
  const fakeArticle = { querySelector(selector) { return selector.includes('/status/') ? { getAttribute: () => '/someone/status/123456789' } : { textContent: 'root' }; } };
  assert.equal(E.isReplyArticle(fakeArticle, url), false);
});

test('scope settings migrate effective reply behaviour and require opt-in for For you', () => {
  for (const legacy of [{}, { commentsOnly: false }, { commentsOnly: true }]) {
    const config = E.normalizeConfig(legacy);
    assert.equal(config.filterReplies, true);
    assert.equal(config.filterForYou, false);
    assert.equal(E.scopeEnabled(config, 'replies'), true);
    assert.equal(E.scopeEnabled(config, 'forYou'), false);
  }
  const config = E.normalizeConfig({ filterReplies: false, filterForYou: true });
  assert.equal(E.scopeEnabled(config, 'replies'), false);
  assert.equal(E.scopeEnabled(config, 'forYou'), true);
  assert.equal(E.scopeEnabled({ ...config, enabled: false }, 'forYou'), false);
  assert.equal(E.scopeEnabled(config, ''), false);
});

test('For you requires a positively selected home tab and never treats Following as For you', () => {
  const doc = (labels) => ({ querySelectorAll: () => labels.map((textContent) => ({ textContent })) });
  for (const label of ['For you', '为你推荐', '推荐', '為你推薦']) {
    assert.equal(E.pageScope('https://x.com/home?x=1', doc([label])), 'forYou');
  }
  for (const labels of [[], ['Following'], ['正在关注'], ['A list']]) {
    assert.equal(E.pageScope('https://x.com/home', doc(labels)), '');
  }
  for (const path of ['search', 'someone', 'i/lists/123', 'home/other']) {
    assert.equal(E.pageScope(`https://x.com/${path}`, doc(['For you'])), '');
  }
  assert.equal(E.pageScope('https://x.com/a/status/123', doc([])), 'replies');
});

test('extraction includes quoted text and allows media-only author evidence', () => {
  let texts = [{ textContent: '外层正常讨论' }, { textContent: '引用中的招揽文字' }];
  let author = 'Example @example';
  const article = {
    querySelectorAll: () => texts,
    querySelector(selector) {
      if (selector.endsWith(' time')) return { closest: () => ({ getAttribute: () => '/example/status/456' }) };
      if (selector === E.SELECTORS.userName) return { textContent: author };
      return null;
    }
  };
  let comment = E.extractComment(article);
  assert.equal(comment.tweetId, '456');
  assert.match(comment.text, /外层正常讨论.*\[引用文字\] 引用中的招揽文字/);
  texts = [];
  comment = E.extractComment(article);
  assert.equal(comment.text, '');
  assert.match(E.composeComment(comment), /\[用户名\] Example @example/);
  assert.match(E.composeComment({ ...comment, biography: '作者简介' }), /\[作者公开简介\] 作者简介/);
  author = '';
  assert.equal(E.extractComment(article), null);
});

test('profile biographies require structured data identifying the requested author', () => {
  const profile = (person) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'ProfilePage', mainEntity: person })}</script>`;
  const person = { '@type': 'Person', url: 'https://x.com/Example', description: '公开 &amp; 简介' };
  assert.equal(E.profileBiography(profile(person), 'example'), '公开 & 简介');
  assert.equal(E.profileBiography(profile(person), 'other'), '');
  assert.equal(E.profileBiography(profile({ ...person, url: 'https://x.com/example/other' }), 'example'), '');
  assert.equal(E.profileBiography('<meta name="description" content="Log in to X">', 'example'), '');
  assert.equal(E.profileBiography('<script type="application/ld+json">broken</script>', 'example'), '');
  assert.equal(E.profileBiography('x'.repeat(524289), 'example'), '');
  for (const handle of ['../home', 'home', 'i', 'https://example.com', 'too_long_for_an_x_handle']) assert.equal(E.normalizeHandle(handle), '');
});

test('author biography changes invalidate classification cache identity', async () => {
  const comment = { author: 'Example @example', text: '' };
  const first = E.composeComment({ ...comment, biography: 'first public biography' });
  const second = E.composeComment({ ...comment, biography: 'updated public biography' });
  assert.notEqual(await E.cacheKey(first, E.DEFAULT_RULES), await E.cacheKey(second, E.DEFAULT_RULES));
});

test('storage config sanitises keys for UI and keeps keys out of normal config', async () => {
  const data = {};
  const area = {
    get(key, callback) { callback({ [key]: data[key] }); },
    set(value, callback) { Object.assign(data, value); callback(); },
    remove(key, callback) { delete data[key]; callback(); }
  };
  const fakeChrome = { storage: { local: area } };
  await E.saveConfig(fakeChrome, { typesafeApiKey: 'apikey_secret', enabled: false });
  const safe = await E.loadConfig(fakeChrome, false);
  const withSecret = await E.loadConfig(fakeChrome, true);
  assert.equal(safe.typesafeApiKey, undefined);
  assert.equal(withSecret.typesafeApiKey, 'apikey_secret');
  assert.equal(safe.enabled, false);
  assert.equal(E.maskSecret('apikey_secret'), 'apik•••••cret');
});

test('privacy-safe debug logging strips API keys and raw text', () => {
  const seen = [];
  const previous = global.console;
  global.console = { debug: (_event, payload) => seen.push(payload) };
  E.debugLog({ debug: true }, 'event', { apiKey: 'secret', content: 'private', contentHash: 'hash' });
  global.console = previous;
  assert.deepEqual(seen, [{ contentHash: 'hash' }]);
});

test('error mapping is fail-open friendly and never returns raw error text', () => {
  assert.equal(E.cleanError({ status: 401, message: 'Bearer secret' }), 'API_KEY_INVALID');
  assert.equal(E.cleanError({ status: 429 }), 'RATE_LIMITED');
  assert.equal(E.cleanError({ status: 503 }), 'API_SERVER_ERROR');
  assert.equal(E.cleanError({ name: 'AbortError', message: 'secret' }), 'API_TIMEOUT');
  assert.equal(E.cleanError({ message: 'secret endpoint=https://private' }), 'API_UNAVAILABLE');
});
