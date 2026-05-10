export * from './types';
export * from './registry';
export * from './router';
export * from './wake-router';
// `./openai-realtime` is intentionally NOT re-exported here: it pulls DOM
// types (RTCPeerConnection, MediaStream, …) which would force every
// transitive consumer to add the DOM lib. Webview/web callers import the
// adapter directly via `@metu/voice/openai-realtime`. Same applies to
// `./anthropic-realtime`, `./local-whisper`, `./piper` (all opt-in via
// subpath imports so non-webview consumers don't pay the side-effect cost).
