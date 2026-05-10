# Mobile wake-word PCM spike

> Status: **research only** — no code yet. Captures the trade-offs and
> the recommended path before we touch `apps/mobile`.

## Goal

Always-on, low-power wake-word detection on the metu mobile app
("hey metu") so the user can summon the Conductor without unlocking the
phone or opening the app. When the wake word fires we want to:

1. Open a 16 kHz mono PCM stream.
2. Buffer ~2 s of pre-roll (audio captured _before_ the wake word so the
   first syllable of the utterance isn't clipped).
3. Stream PCM frames to the metu hub via the existing WS channel.
4. Stop on VAD silence (≥ 800 ms of low energy).

## Constraints

- **Battery**: must run < 2 % / hour while idle. Rules out a
  JS-side mic loop in Expo's React Native runtime.
- **Privacy**: PCM never leaves the device until the wake word is
  detected. The detector itself runs entirely on-device.
- **iOS background**: Apple only allows background audio for VoIP,
  audio playback, or recording with the user's explicit permission and
  a visible indicator. We will need the `audio` background mode and a
  persistent live-activity / Dynamic Island indicator.

## Library matrix

| Lib                                 | License    | iOS | Android | Wake-word? | Notes                                                                          |
| ----------------------------------- | ---------- | --- | ------- | ---------- | ------------------------------------------------------------------------------ |
| `expo-audio` (new)                  | MIT        | ✅  | ✅      | no         | Records to file; no PCM frame access. Useless on its own.                      |
| `@siteed/expo-audio-stream`         | MIT        | ✅  | ✅      | no         | Streams PCM frames to JS. Only viable Expo-friendly mic source.                |
| `react-native-voice`                | MIT        | ✅  | ✅      | partial    | OS-native STT. Wake word is the OS's, not ours.                                |
| `@picovoice/porcupine-react-native` | commercial | ✅  | ✅      | yes        | Industry standard. ~3 MB model per keyword. Free for < 3 monthly active users. |
| `openwakeword`                      | Apache     | n/a | n/a     | yes        | Python only — would need a custom RN bridge.                                   |

**Recommendation**: pair `@siteed/expo-audio-stream` (PCM source) with
`@picovoice/porcupine-react-native` (detector). Picovoice's free tier
covers solo dev usage; production rollout flips to their growth tier.

If we want to stay 100 % FOSS we'd port `openwakeword` to a TFLite
model and run it through `react-native-fast-tflite`. ~1 week of work.
Picovoice is 1 day. Punt to v2.

## Architecture sketch

```
[ Mic ]
   │  (PCM 16 kHz mono, 30 ms frames)
   ▼
[ expo-audio-stream ] ──► ring buffer (2 s)
   │
   ▼
[ Porcupine wake-word ] ── on hit ──► open WS to hub
                                       │
                                       ▼
                                  send pre-roll + live frames
                                       │
                                       ▼
                                  [ web ] → @metu/voice → STT → companion-agent
```

## Hub protocol changes needed

- New `client.audio.start` envelope: `{ sampleRate, encoding: 'pcm_s16le', channels: 1 }`.
- Streaming `client.audio.frame` with base64-encoded PCM (or binary WS
  frames if we move to binary protocol — preferable for size).
- `client.audio.end` to flush.

The web side already has `@metu/voice` for STT — wiring this into the
hub requires a per-stream session id and routing to `transcribeRemoteAudio`.

## Background-mode UX

- iOS: live-activity card "metu is listening" with a stop button. Tap
  the activity → opens the conductor chat. Without this Apple will
  reject the build.
- Android 14+: foreground service with the `microphone` type and a
  persistent notification.

## Permissions

- iOS `NSMicrophoneUsageDescription`: "metu listens for the wake phrase
  to summon your AI assistant. Audio stays on your phone until you say
  the wake word."
- Android `RECORD_AUDIO` + `FOREGROUND_SERVICE_MICROPHONE`.

## Cost estimate

- Picovoice growth tier: ~$15 / 1k MAU in 2024 pricing.
- Hub bandwidth: 16 kHz × 2 B = 32 kB/s. 30 s utterance = ~1 MB. Fine.
- Worker STT: ~$0.006 / minute via Whisper API. Negligible for solo use.

## Recommended next steps

1. **Tracer-bullet** (1 day): wire `expo-audio-stream` in `apps/mobile`
   and dump PCM frames to Metro logs. No wake-word, no upload — just
   prove the pipe exists.
2. **Local detector** (1 day): drop in Porcupine with the built-in
   "porcupine" keyword. Console-log on hit. Verify battery impact on
   a real device for 1 hour.
3. **Custom keyword** (training): record "hey metu" samples, train via
   the Picovoice console. Replace the test keyword.
4. **Hub upload** (2 days): implement `client.audio.*` envelopes,
   buffer pre-roll, stream live frames, terminate on VAD silence.
5. **Web side** (1 day): route hub-relayed audio into `@metu/voice`,
   call companion-agent with the transcript.
6. **Background mode** (2 days): live-activity on iOS,
   foreground-service on Android.

Total: ~7 dev days for a v1.

## Decisions to lock before implementation

- [ ] OK with Picovoice as a runtime dep + commercial fallback?
- [ ] Stream audio over the existing hub WS or a dedicated binary WS?
- [ ] How long do we keep PCM on disk (none, 24 h, until next sync)?
- [ ] Single wake word ("hey metu") or also a "panic" word (e.g.
      "metu, stop") that immediately silences active autonomy?

Once these are answered, file a slice in `docs/master-plan.md` and
proceed with step 1.
