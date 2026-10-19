# purpur

**Push-to-talk voice typing for macOS.** Hold a key, speak, and purpur types the
text into whatever app has focus — cleaned up, punctuated, and inserted at your
cursor. It is an original, open implementation of the dictation workflow made
popular by Wispr Flow, rebuilt from scratch after a static reverse-engineering
study of that product (see [Provenance](#provenance)).

```
hold right ⌥ → speak → release → text appears at your cursor
```

No account, no telemetry, no cloud storage. Your audio goes only to the
transcription provider you configure (or stays entirely local with whisper.cpp).

---

## Features

- **Global push-to-talk** — right `⌥` hold (default), `Fn` hold, or `Fn`
  double-tap toggle, captured system-wide by a Swift helper via `CGEventTap`.
  An Electron `globalShortcut` fallback (`⌘⇧Space`) works even without the helper.
- **Non-focusable floating pill** — shows listening state, a live level meter and
  partial transcripts without ever stealing focus from the target app.
- **16 kHz mono audio pipeline** — `AudioWorklet` capture → PCM → WAV in the main
  process. No ffmpeg, no native audio dependencies.
- **Pluggable transcription**
  - any OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI, gateways, local servers),
  - a local `whisper.cpp` CLI,
  - a built-in `mock` provider so the whole loop can be demoed with no API key.
- **Optional AI cleanup pass** — removes fillers, fixes punctuation and formats
  as clean prose, email, notes, code-aware text, or punctuation-only. Your
  dictionary is always applied locally, before and after cleanup.
- **Context-aware formatting** — the focused app, field and selected text can
  inform spelling/capitalization (never adds content).
- **Accessibility insertion with paste fallback** — inserts through
  `AXUIElementSetAttributeValue`; falls back to clipboard paste with clipboard
  restore when an app doesn't support AX text insertion.
- **Local history + dictionary** — searchable history and word-level
  substitutions stored as plain JSON in the app's userData directory.
- **Menu-bar app** — tray menu for Start/Stop, Settings, History and Quit.
- **Permissions dashboard** — live status for Microphone, Accessibility and
  Input Monitoring, with deep links into System Settings.

---

## Requirements

| Requirement | Notes |
|---|---|
| macOS 12+ | Accessibility and `CGEventTap` are macOS APIs |
| Node.js 18+ | developed on Node 24 |
| Xcode Command Line Tools | provides `swiftc` to build Purpur Helper (`xcode-select --install`) |
| Whisper model (optional) | only for the local `whisper.cpp` provider |

---

## Install

```bash
git clone <this-repo> purpur
cd purpur
npm install          # Electron (only dependency)
npm run setup        # generates icons/sounds + compiles Purpur Helper
npm start            # launches the menu-bar app
```

`npm run setup` runs:

- `npm run gen:assets` — writes original icons and UI sounds into `assets/`,
- `npm run build:helper` — compiles `helper/main.swift` into
  `helper/dist/Purpur Helper.app` and ad-hoc signs it.

---

## First-run permissions

purpur needs three macOS permissions. Open **purpur → Settings → Permissions**
and use the buttons, or go directly to:

| Permission | Grantee | Why | System Settings pane |
|---|---|---|---|
| Microphone | purpur (Electron) | record your voice | Privacy & Security → Microphone |
| Accessibility | **Purpur Helper** | read focused context and insert text | Privacy & Security → Accessibility |
| Input Monitoring | **Purpur Helper** | receive the global Fn/⌥ key events | Privacy & Security → Input Monitoring |

After **rebuilding the helper** (ad-hoc signature changes), macOS may silently
drop its permissions — re-add it in both panes if the hotkey or insertion stops
working.

> The helper is a separate background app (`LSUIElement`, bundle id
> `com.purpur.helper`). On first launch it shows the standard Accessibility
> prompt; approving it is required for insertion and context.

---

## Using purpur

| Action | Default |
|---|---|
| Start/stop dictation | hold **right ⌥** (push-to-talk) |
| Alternate triggers | Settings → General: `Fn` hold, `Fn` double-tap toggle, or none |
| Fallback toggle | `⌘⇧Space` (configurable) |
| Tray menu | Start/Stop, Settings, Quit |

The pill appears at the bottom of the screen while recording:

| State | Pill shows |
|---|---|
| `listening` | level meter + live partial text (cloud providers only) |
| `processing` | “Transcribing…” |
| `cleanup` | “Polishing…” |
| `inserting` | “Typing…” |
| `inserted` | “Inserted” + text, then hides |
| `error` | the error message (bad key, no speech, missing permission, …) |

---

## Transcription providers

Configure in **Settings → Transcription**.

### 1. Mock (default, no key)

Returns a placeholder sentence. Use it to verify hotkeys, permissions, the pill
and insertion end-to-end without any credentials.

### 2. OpenAI-compatible

Any endpoint implementing `POST /audio/transcriptions` (multipart form with
`file`, `model`, optional `language`) works.

| Field | Example |
|---|---|
| Base URL | `https://api.openai.com/v1` |
| API key | `sk-…` |
| Model | `gpt-4o-transcribe`, `whisper-1` |
| Language | `en` (optional) |

“Live partial transcripts” sends the accumulated audio every ~2.4 s while you
speak (extra requests; disable to reduce cost).

### 3. Local whisper.cpp

| Field | Example |
|---|---|
| whisper binary | `/opt/homebrew/bin/whisper-cli` |
| Model file | `/Users/you/models/ggml-base.en.bin` |
| Arguments | `-m {model} -f {wav} -nt` |

`{wav}` and `{model}` are substituted at runtime. Local transcription runs on
release (no live partials) and keeps audio entirely on-device.

### Testing

“Test transcription” sends one second of silence and shows the provider's echo
(or the exact error). Errors are also surfaced in the pill.

---

## AI cleanup (optional)

Enable in **Settings → Cleanup**. The raw transcript is sent to an
OpenAI-compatible `POST /chat/completions` endpoint with a formatter prompt; the
result replaces the text before insertion. Styles:

- **Clean prose** — remove fillers/false starts, fix punctuation;
- **Email** — concise professional formatting;
- **Notes** — bullet points where you listed items;
- **Code-aware** — preserve identifiers and file names;
- **Punctuation only** — no word removal.

Failure policy: if cleanup errors out, purpur inserts the raw transcript and logs
the failure. The dictionary is applied both before and after cleanup.

**Privacy:** cleanup is off by default. When enabled, the transcript (plus the
focused app/field name and a short selection excerpt for context) is sent to the
endpoint you configured.

---

## Dictionary

Settings → Dictionary. Word-level substitutions applied to every transcript,
case-insensitively and on word boundaries, e.g.

```
whisper flow → Wispr Flow
gee pee tee → GPT
```

---

## History & privacy

- Stored locally: `~/Library/Application Support/purpur/history.json` and
  `settings.json` (Electron userData). Search, copy and delete from
  Settings → History; “Clear all” wipes the file.
- Audio is kept in memory only for the duration of a dictation. No recordings
  are written to disk.
- No telemetry, analytics or accounts. Network requests happen only to the
  transcription/cleanup endpoints you configure.

---

## Architecture

```
┌──────────────┐   CGEventTap (Fn / right ⌥)   ┌────────────────────────────┐
│ Purpur Helper│ ───────── JSONL stdio ───────▶│       purpur main          │
│   (Swift)    │ ◀── insert / context / perms ──│      (Electron)            │
└──────────────┘                                └────────────┬───────────────┘
      │ AXUIElement reads/writes                             │ IPC
      ▼                                                      ▼
┌──────────────┐   AudioWorklet 16 kHz PCM      ┌────────────────────────────┐
│ focused app  │ ◀──── AX insert / paste ───────│  pill overlay (renderer)   │
└──────────────┘                                │  settings + history (UI)   │
                                                └────────────┬───────────────┘
                                                             │
                                        transcription ──▶ cleanup ──▶ history
                                  (OpenAI-compatible / whisper.cpp / mock)
```

Helper protocol (line-delimited JSON over stdin/stdout):

| Direction | Message |
|---|---|
| helper → app | `{"type":"event","event":"hotkey","phase":"start\|stop","source":"option-hold"}` |
| helper → app | `{"type":"event","event":"ready","trigger":…,"permissions":{…}}` |
| app → helper | `{"cmd":"set-trigger","trigger":"option-hold\|fn-hold\|fn-doubletap\|none"}` |
| app → helper | `{"cmd":"context","id":n}` → frontmost app + focused role/field/selection/value |
| app → helper | `{"cmd":"insert","id":n,"text":"…"}` → `{method:"ax"\|"paste", ok}` |
| app → helper | `{"cmd":"permissions","id":n}` · `{"cmd":"quit"}` |

---

## Project layout

```
src/main/main.js      app lifecycle, tray, windows, orchestration
src/main/helper.js    helper process + JSONL protocol + paste fallback
src/main/stt.js       WAV encoding, providers, dictionary
src/main/cleanup.js   formatter prompt + chat-completions call
src/main/store.js     settings/history JSON stores
src/preload/          contextBridge API
src/renderer/         pill overlay + settings/history UI (plain HTML/CSS/JS)
helper/main.swift     CGEventTap, Accessibility context + insertion, paste
helper/build.sh       compiles and ad-hoc signs Purpur Helper.app
scripts/gen-assets.js generates original PNG icons and WAV sounds
scripts/selftest.js   module-level checks
scripts/probe-helper.js  protocol smoke test for the helper
```

---

## Development

```bash
npm run selftest       # store, WAV, dictionary, prompt, assets, helper, mock STT
npm run probe-helper   # spawns the helper: ready → trigger switch → context → quit
npm run smoke          # boots the whole app, prints SMOKE OK, exits
npm start              # normal run (tray + helper)
```

Notes:

- The helper is compiled with Swift 6 / Command Line Tools; no Xcode project.
- `scripts/probe-helper.js` intentionally does **not** send `insert` — that
  would type into whatever app is focused.
- Logs from the main process go to stdout; run from a terminal to see them.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tray says “Helper: not built” | `npm run build:helper` (needs `swiftc`) |
| Hotkey does nothing | Grant **Input Monitoring** to Purpur Helper; re-grant after rebuilds; check the trigger in Settings → General |
| Pill appears but nothing is typed | Grant **Accessibility** to Purpur Helper; or switch Insert method to “Clipboard paste” |
| “no speech detected” | Check the microphone permission and input device; speak after the pill appears |
| `STT 401` / `STT 404` | Wrong API key, base URL or model name — use “Test transcription” |
| Fallback shortcut does nothing | Another app owns `⌘⇧Space`; choose another chord |
| Insert changes formatting in a rich editor | Prefer the paste method for that app |

---

## Limitations (by design)

- macOS only.
- No meeting/system-audio capture, Bluetooth mic-ring support, cloud sync,
  teams/billing, or analytics — features of the product studied, intentionally
  not rebuilt.
- No streaming STT protocol; cloud partials re-send accumulated audio.
- History and settings are JSON, not SQLite; fine for personal scale.

---

## Provenance

purpur was designed after a **static** reverse-engineering study of
**Wispr Flow v1.6.1174** (`Flow-v1.6.1174.dmg`) using REA. The shipped artifact
was inspected — never executed for the study. Findings that informed this
implementation (Electron shell, Swift `accessibility-mac-app` helper using
`CGEventTap`/AX APIs, Opus streaming workers, `flow.sqlite` history, AX context
traces) are documented with artifact digests and evidence IDs in
[`DESIGN.md`](DESIGN.md). The full REA evidence bundle is kept locally and is not
committed (113 MB).

**No code, assets, prompts, or other files from Wispr Flow are copied or
included.** All source, icons and sounds in this repository are original.
purpur is not affiliated with, endorsed by, or sponsored by Wispr Flow.
“Wispr Flow” is a trademark of its respective owner and is referenced only for
descriptive, interoperability-analysis purposes.

---

## License

[MIT](LICENSE)
