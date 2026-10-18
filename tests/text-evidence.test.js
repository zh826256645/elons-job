const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/shared/core.js');

function articleFixture() {
  const anchor = (href, title = '', textContent = '') => ({ textContent, getAttribute: (name) => ({ href, title }[name] || '') });
  return {
    querySelector(selector) {
      if (selector.endsWith(' time')) return { closest: () => anchor('/example/status/123') };
      if (selector === E.SELECTORS.userName) return { textContent: 'Example @example', querySelector: () => anchor('/example') };
      if (selector.includes('video')) return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector === E.SELECTORS.tweetText) return [{ textContent: 'https://clips.example/video.mp4' }];
      if (selector === 'a[href]') return [anchor('/example/status/123'), anchor('https://t.co/short', 'https://clips.example/video.mp4'), anchor('https://t.co/short', 'https://clips.example/video.mp4')];
      if (selector.includes('card.wrapper')) return [{ textContent: '公开链接卡片标题' }];
      return [];
    }
  };
}

test('extraction retains expanded links, card text and media presence without image data', () => {
  const comment = E.extractComment(articleFixture());
  assert.deepEqual(comment.links, ['https://clips.example/video.mp4']);
  assert.equal(comment.cardText, '公开链接卡片标题');
  assert.equal(comment.hasMedia, true);
  const content = E.composeComment(comment);
  assert.match(content, /\[外链\] https:\/\/clips.example\/video.mp4/);
  assert.match(content, /\[链接卡片文字\] 公开链接卡片标题/);
  assert.equal(content.includes('data:image'), false);
});

test('local keywords inspect full source text without AI truncation or generated quote labels', () => {
  const article = articleFixture();
  const original = article.querySelectorAll;
  article.querySelectorAll = (selector) => selector === E.SELECTORS.tweetText
    ? [{ textContent: '普通内容'.repeat(1500) }, { textContent: '女菩萨' }]
    : original(selector);
  const comment = E.extractComment(article);
  assert.equal(comment.text.includes('女菩萨'), false);
  assert.equal(E.localKeywordDecision(comment, ['女菩萨']).shouldHide, true);
  assert.equal(E.localKeywordDecision(comment, ['引用文字']).shouldHide, false);
  assert.ok(E.composeComment(comment).length <= E.MAX_COMMENT_LENGTH);
});

test('For you trusts a threshold-crossing spam score on link-only posts', () => {
  const comment = { author: 'Gabriel @example', text: 'https://clips.example/video.mp4', links: ['https://clips.example/video.mp4'], hasMedia: true };
  const context = { scope: 'forYou', content: E.composeComment(comment), linkEvidence: E.linkEvidence(comment) };
  const response = { answers: { sexual_content: { noul: 0.13 }, sexual_solicitation: { noul: 0.32 }, spam_behavior: { noul: 0.8 } } };
  assert.equal(E.buildDecision(response, E.DEFAULT_RULES, context).shouldHide, true);
  assert.equal(E.buildDecision(response, E.DEFAULT_RULES, { ...context, scope: 'replies' }).shouldHide, false);
  assert.equal(E.buildDecision({ answers: { spam_behavior: { noul: 0.4 } } }, E.DEFAULT_RULES, context).shouldHide, false);
  const disabled = E.DEFAULT_RULES.map((rule) => rule.id === 'spam_behavior' ? { ...rule, enabled: false } : rule);
  assert.equal(E.buildDecision(response, disabled, context).shouldHide, false);
});

test('normal discussion with an external link retains the spam safeguard', () => {
  const comment = { text: '这份太空飞行报告值得一读 https://science.example/report', links: ['https://science.example/report'] };
  const linkEvidence = E.linkEvidence(comment);
  assert.equal(linkEvidence.linkOnly, false);
  assert.equal(E.buildDecision({ answers: { spam_behavior: { noul: 0.8 } } }, E.DEFAULT_RULES, { scope: 'forYou', content: E.composeComment(comment), linkEvidence }).shouldHide, false);
  assert.equal(E.linkEvidence({ text: 'https://x.com/SpaceX/status/123', links: ['https://x.com/SpaceX/status/123'] }).linkOnly, false);
  assert.equal(E.linkEvidence({ text: '普通短句', links: [] }).linkOnly, false);
});

test('link evidence excludes local schemes, credentials and X navigation URLs', () => {
  const evidence = E.linkEvidence({ text: '', links: ['javascript:alert(1)', 'data:image/png;base64,abc', 'https://name:secret@example.com/file', 'https://x.com/home', 'https://pbs.twimg.com/media/image.jpg', 'https://clips.example/video.mp4'] });
  assert.deepEqual(evidence.links, ['https://clips.example/video.mp4']);
  assert.equal(evidence.linkOnly, true);
});

test('long bodies retain author and link evidence within the text input budget', () => {
  const content = E.composeComment({ author: 'Author @example', biography: '作者公开简介', text: '普通内容'.repeat(2000), links: ['https://clips.example/video.mp4'], cardText: '链接卡片标题' });
  assert.ok(content.length <= E.MAX_COMMENT_LENGTH);
  assert.match(content, /作者公开简介/);
  assert.match(content, /https:\/\/clips.example/);
  assert.match(content, /链接卡片标题/);
});

test('scope-specific decisions cannot share a classification cache entry', async () => {
  assert.notEqual(await E.cacheKey('same content', E.DEFAULT_RULES, E.MODEL_VERSION, 'forYou'), await E.cacheKey('same content', E.DEFAULT_RULES, E.MODEL_VERSION, 'replies'));
});

test('profile metadata is accepted only for the matching author and excludes login boilerplate', () => {
  const html = '<meta property="og:url" content="https://x.com/example"><meta property="og:title" content="Example (@example) / X"><meta property="og:description" content="Public creator biography &amp; links">';
  assert.equal(E.profileBiography(html, 'example'), 'Public creator biography & links');
  assert.equal(E.profileBiography(html, 'other'), '');
  assert.equal(E.profileBiography(html.replace('Public creator biography &amp; links', 'Log in to see more'), 'example'), '');
});
