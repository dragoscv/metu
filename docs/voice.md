# Voice capture

metu's voice capture pipeline runs **two paths in parallel** for the best
UX, falling back gracefully when either is unavailable.

## Quick capture (web)

`Cmd/Ctrl+Shift+K` opens the QuickCapture modal. A mic button switches
the modal into voice mode.

### Path A — MediaRecorder → Whisper (ground truth)

1. `getUserMedia({ audio: true })` opens the microphone.
2. `MediaRecorder` records chunks as `audio/webm;codecs=opus` (falls
   back to plain `audio/webm` when the codec isn't supported).
3. On stop, the assembled `Blob` is uploaded to
   `POST /api/voice/transcribe` as multipart form data.
4. The route calls **OpenAI whisper-1** using the workspace's BYOK
   credential (`getProviderCredential(workspaceId, 'openai')`).
5. The transcript replaces whatever's in the textarea.

Limits:

- ≤ 25 MB upload (Whisper hard limit).
- 30 transcriptions / minute / user (rate-limited via the same shared
  Redis bucket as other SDK writes).

### Path B — Web Speech API (live preview)

While Path A is recording, we also start a `SpeechRecognition` session
(or `webkitSpeechRecognition`) with `continuous = true` and
`interimResults = true`. Interim results stream into the textarea so
the user sees words as they speak.

When the recording stops, the Whisper response **overwrites** the
interim transcript. Whisper handles punctuation, accents, and proper
nouns better than browser-side SR engines, so it wins.

Path B is best-effort:

- Chromium browsers: works.
- Firefox / Safari: silent no-op (Path A still produces a transcript).

### Fallback when BYOK is missing

If `getProviderCredential(workspaceId, 'openai')` returns nothing, the
route responds with `{ error: 'openai_credential_missing' }`. The UI
keeps whatever Path B produced and shows a toast pointing the user at
`/settings/byok`.

## Companion / mobile

The Tauri companion and the Expo mobile app use platform-native voice
APIs (system speech recognition + on-device wake word). They post the
final transcript via `POST /api/sdk/v1/capture` with `kind: 'voice'`.
See [`mobile-wake-word.md`](./mobile-wake-word.md).

## Privacy

- Audio bytes are **not stored**. The route uploads them to OpenAI,
  receives a transcript, and discards the buffer.
- The transcript becomes a normal `capture` row (`kind = 'text'`) and
  follows the standard memory retention policy.
- BYOK ensures the audio never touches metu's own OpenAI account.
