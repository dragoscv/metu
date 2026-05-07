---
applyTo: 'apps/mobile/**'
description: Expo Router mobile app — push notifications, OAuth device flow.
---

# Expo mobile app (`apps/mobile`)

## Stack

- Expo (managed) + Expo Router (file-system routing under `app/`).
- React Native + the same `@metu/sdk` and `@metu/protocol` packages used
  everywhere else.

## Auth

- OAuth2 device flow (see [auth-and-oauth.instructions.md](./auth-and-oauth.instructions.md)).
- Public client; no client secret bundled.
- Tokens stored via `expo-secure-store`. Never `AsyncStorage` for tokens.

## Push notifications

- Register the Expo push token via `POST /api/sdk/v1/push/register`
  (scope `notify:read`).
- Notification tap → deep-link into the relevant route.
- Handle the case where the token rotates — re-register on app start if it
  changed.

## What NOT to do

- ❌ Hardcode the API base URL. Use `Constants.expoConfig.extra.metuApi`.
- ❌ Store tokens in `AsyncStorage`.
- ❌ Re-implement schemas — import from `@metu/protocol`.
