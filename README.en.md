# Elon's Job

A Chrome Manifest V3 extension for X. Use your own TypeSafe Jev API key to filter detail-page replies and optional For you posts. Matching content is hidden locally with an option to restore it in place.

[中文](README.md) · [Privacy Policy](privacy.html) · [MIT License](LICENSE)

## Current features

### Independent filtering scopes

| Scope | Default | Behavior |
| --- | --- | --- |
| Detail-page replies | On | Filters replies and skips the root post |
| Home For you feed | Off | When enabled, filters the selected For you feed, including reposts, ads and quoted text |

The global protection switch controls both scopes. Following, search, profiles, lists and direct messages are excluded. Disabling a scope or leaving it restores hidden content and invalidates pending results.

### Local keyword blacklist

- Includes “女菩萨” by default. Add or delete keywords in settings; an empty list disables keyword filtering, and updates preserve deletions.
- Within enabled scopes, a keyword in the username, body (including quotes), external links, card text or available author biography hides the card before AI classification. No API key or request quota is needed.
- Uses literal substring matching, ignoring English case, Unicode width differences and invisible characters. Regular expressions are not supported.
- Shows matched keywords with an in-place restore button. Nonmatching content continues through the existing AI checks.

### Text, links and author context

- Combines body and quoted text with displayed external links and link-card text.
- Attempts to retrieve public author biographies for For you posts and media replies, accepting only information matched to the author.
- Falls back to available body, username and link text when a biography is unavailable. Media-only posts can use author names; posts without usable text evidence are skipped.
- Includes three rules: sexual content, sexual solicitation and spam, with default thresholds of 65%, 75% and 78% respectively.
- Supports individual rule switches, threshold adjustment and natural-language custom rules that can be added, edited or deleted.
- Link-only For you posts can be hidden when the spam score reaches its threshold. Normal discussions and detail-page replies retain the existing safeguards; an external link alone does not trigger hiding.

**The extension analyzes text only. It does not inspect or send image/video pixels, or visit external sites linked from posts.** Explicit media with ordinary captions can still be missed.

### Recoverable hiding and cost controls

- Hides the entire matching card, displays its rule and confidence, and offers an in-place restore button.
- Provides per-item checks, rechecks and page inspection statistics.
- Uses classification caching, request deduplication, concurrency limits and a daily request cap. Defaults are 3 concurrent requests and 100,000 requests per day, adjustable in settings.
- Stops AI filtering when the API fails, times out, has no key or reaches the request cap. Local keyword filtering remains active.
- Caches public author information in browser session storage: successful lookups for 24 hours, failures for 10 minutes, up to 200 authors. The settings cache action clears it as well.

The daily cap limits request count; it is not a free allowance. TypeSafe bills actual text classification usage.

## Local installation and updates

Requirements: Node.js 20 or later. AI filtering also needs your own TypeSafe API key; local keyword filtering works without one.

Run from the project root:

```bash
npm test
npm run check
npm run package
```

Then in Chrome:

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select this project's generated `dist/` directory.
3. Configure and test your TypeSafe API key in the first-install onboarding page.
4. Enable **过滤 For you 帖子** in settings if you want home-feed filtering.
5. Open or refresh X.

After updating the code, run `npm run package`, click **Reload** on the extension's card in Chrome, and refresh X. Existing installations do not need to load the directory again.

## Interface preview

Recoverable placeholders in the reply view:

<p align="center">
  <img src="docs/screenshots/comment-filtering.png" alt="Reply filtering on X" width="720">
</p>

Custom rule editor:

<p align="center">
  <img src="docs/screenshots/custom-rule-editor.png" alt="Custom filtering rule editor" width="720">
</p>

## Data and privacy

- The API key is stored locally and read only by the service worker for TypeSafe authentication. It is not written to the X page DOM or debug logs.
- Local keyword matches are not sent to TypeSafe. Nonmatching usernames, body and quoted text, links, card text and available public biographies are sent directly to TypeSafe over HTTPS, without a developer-operated backend.
- Public author pages are requested without credentials. Login pages, HTTP 403 responses or missing metadata can make biographies unavailable.
- Classification results are cached under hashes of input text, rules, model and scope; raw post text is not stored. Public biographies have a separate cache.
- The extension does not read browsing history, cookies, X login credentials or direct messages, or modify original posts on X.
- It does not request `tabs`, `history`, `cookies`, `webRequest` or `<all_urls>` permissions.

See the [Privacy Policy](privacy.html) for details.

## Development checks

`npm test` uses deterministic mocks for configuration migration, scope detection, quote/link extraction, profile validation and fallback, decision thresholds, cache isolation, concurrency and fail-open behavior. It does not call the real TypeSafe API.

The evaluation corpus is in `tests/fixtures/comment-corpus.json`. To evaluate the real model, set `TYPESAFE_API_KEY` in `.env` or the environment and run the commands below as needed. **These commands call the real API and incur charges; they are not installation steps.**

```bash
# Small-sample evaluation
npm run benchmark -- --limit=10

# Debug specific samples; separate multiple IDs with commas
npm run benchmark -- --id=hide-040
npm run benchmark -- --ids=hide-040,hide-041

# Full-corpus evaluation
npm run benchmark
```

Evaluation reports Precision, Recall, F1, false-positive/false-negative IDs and latency, with separate spam metrics. Single-sample debugging also prints the input text and per-rule scores, but never the API key.
