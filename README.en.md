# Elon's Job

A local-first Chrome Manifest V3 extension that filters replies on X (`x.com/{user}/status/{id}`) detail pages by default, with optional For you post filtering in settings. It uses the user's own TypeSafe Jev API key to display recoverable hidden placeholders for high-confidence pornographic, sexually suggestive, and promotional comments.

[Privacy Policy](privacy.html)

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/elon%E7%9A%84%E5%B7%A5%E4%BD%9C/aillmgiicpcpnnggaahlkifchigmfome)

[中文](README.md)

[MIT License](LICENSE)

## Local Manual Build and Installation

Requirements: Node.js 20 or later.

Run the following commands from the project root to test, validate, and generate the Chrome extension bundle:

```bash
npm test
npm run check
npm run package
npm run benchmark
```

After the build completes, open `chrome://extensions`, enable Developer mode, click “Load unpacked”, and select the generated `dist/` directory. The onboarding page opens automatically the first time you install the extension.

## Preview

<p align="center">
  <img src="docs/screenshots/comment-filtering.png" alt="Comment filtering on X" width="720">
</p>

Matching comments are replaced with recoverable hidden placeholders. The settings center defaults to a daily TypeSafe request limit of 100,000 and provides caching, concurrency, and cost protections.

Filtering rules are customizable: you can edit rule names, hide conditions, exclusion conditions, and sensitivity to fit different community moderation needs.

<p align="center">
  <img src="docs/screenshots/custom-rule-editor.png" alt="Custom comment filtering rule editor" width="720">
</p>

## Security Boundaries

- The API key is read only by the service worker and stored in `chrome.storage.local`; the popup and settings page can only save or test it through the messaging protocol.
- The content script sends post IDs, the active filtering scope, usernames, and body/quoted text to the service worker. For you posts and media replies include an author handle for optional public biography lookup. Expanded links and link-card text are included as text evidence. It does not read cookies, history, X login information, or the root post on detail pages.
- TypeSafe requests use `https://api.typesafe.ai/v1/systemone`. Unexpected API responses, timeouts, 401, 429, and 5xx errors fail open.
- Classification cache keys hash the final input (including any biography), rule fingerprint, and model; raw post text is not stored. A separate session cache stores public author biographies and is also cleared by the settings cache action.
- `manifest.json` does not request `tabs`, `history`, `cookies`, `webRequest`, or `<all_urls>`.

## Test Coverage

`tests/` covers default rules, rule compilation, text normalization, Root Tweet/detail-page scope, SHA-256 cache keys, threshold decisions, API response parsing, storage redaction, and Fail-Open error classification. Actual TypeSafe calls require the user's own API key, so automated tests use deterministic mocks and do not incur API costs.

The local corpus is located at `tests/fixtures/comment-corpus.json`. It includes normal comments, medical/educational content, ordinary romance, appearance-related comments, implicit sexual hints, private content, contact information, emoji, long numeric IDs, sexually explicit or promotional username signals, and the “搞hs / 小马开大车” plus screenshot-annotated `emoji spam` samples. The `emoji spam` samples additionally record `spam: true` and are evaluated separately by the enabled `spam_behavior` rule. That rule uses both TypeSafe scores and duplicate-template signals from emoji-stripped page text; matching samples are included in the final hide decision. The current `npm run benchmark` excludes these samples from the sexual-content rule metrics, but reports separate Precision/Recall/F1 metrics for `spam-samples` rather than treating them as successful samples. After configuring `TYPESAFE_API_KEY` in `.env`, run the benchmark to print only Precision, Recall, F1, false-positive/false-negative IDs, and latency; the API key is never printed. Use `--limit=10` for a small-sample check or `--json` for machine-readable output without original text.

You can also run an exact regression by corpus ID: `bun run benchmark -- --id=hide-040`. A single ID prints detailed evaluation information, including the username, body, emoji-structure signals, default-rule probability/threshold/match status, final decision, and the exact payload sent. Separate multiple IDs with commas: `bun run benchmark -- --ids=hide-040,hide-041`.

## Filtering scope

Reply filtering is on by default; For you post filtering is a separate opt-in setting. Both use the same rules. Following, search, profiles, lists, and the root post on detail pages are excluded. Quoted text is included. For you posts and media replies use author names and, when available, a public profile biography matched to the author and fetched without credentials. Links and card text supplement the body. Link-only For you posts may be hidden when the spam score reaches the configured threshold; normal discussions and replies retain the existing safeguards. External links are not visited for classification. Missing biographies leave the available body, author and link text in use. The extension does not analyze image or video pixels. Turning a scope off restores hidden content and invalidates pending results.
