# Mobile push setup (Expo + EAS)

The metu mobile app talks to Expo's push service to receive notifications
forwarded by `/api/sdk/v1/push/register`. Until you've created an EAS
project, `getExpoPushTokenAsync` rejects with `no_eas_project_id` and the
hook in [`apps/mobile/lib/push.ts`](../apps/mobile/lib/push.ts) surfaces
`{ kind: 'error', error: 'no_eas_project_id (run `eas init`)' }`.

## One-time setup

1. **Install the EAS CLI** (already in catalog deps; the global is optional):

   ```pwsh
   pnpm dlx eas-cli --version   # should print 12.x or later
   ```

2. **Sign in** with the Expo account that owns `ro.metu.app`:

   ```pwsh
   cd apps/mobile
   pnpm dlx eas-cli@latest login
   ```

3. **Initialise the EAS project** (this is the step that mints the
   `projectId`):

   ```pwsh
   pnpm dlx eas-cli@latest init --non-interactive
   ```

   Confirm the suggested slug `metu`. The CLI writes the new `projectId`
   into `app.json` under `expo.extra.eas.projectId`.

4. **Verify** the change:

   ```pwsh
   pnpm --filter @metu/mobile exec node -e "console.log(require('./app.json').expo.extra.eas.projectId)"
   ```

   You should see a UUID. Commit `app.json`.

## Local dev

`expo-notifications` requires a custom dev client (not Expo Go) on
Android 13+. Build it once with EAS:

```pwsh
pnpm dlx eas-cli@latest build --profile development --platform all
```

Install the resulting `.ipa` / `.apk` on your test device, then
`pnpm --filter @metu/mobile start`.

## Production push

The mobile app stores the Expo token via
`POST /api/sdk/v1/push/register` (channel `expo`). The web app fan-outs
push by calling `expo.dev/--/api/v2/push/send`; see
[`apps/web/src/lib/push.ts`](../apps/web/src/lib/push.ts).

No additional secrets are required — Expo handles APNs / FCM credentials
through its console.

## Troubleshooting

| Symptom                                          | Likely cause                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `no_eas_project_id` in the mobile UI             | Step 3 above wasn't run, or the `projectId` is an empty string.                                                                    |
| `paste your metu API token first`                | Mobile app hasn't completed the OAuth device flow yet. Open Settings → Pair device.                                                |
| Push token registers but no notifications arrive | EAS build is out of date — rebuild dev client. Or the device hasn't been linked to a workspace via `/api/sdk/v1/devices/register`. |
| 401 from `/api/sdk/v1/push/register`             | Access token lacks `notify:read` scope. Re-issue with the scope in the OAuth client allowlist.                                     |
