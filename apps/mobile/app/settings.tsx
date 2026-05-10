import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { getToken, setToken } from '../lib/api';
import { useRegisterPush } from '../lib/push';

export default function SettingsScreen() {
  const [token, setLocal] = useState('');
  useEffect(() => {
    getToken().then(setLocal);
  }, []);
  const push = useRegisterPush();

  function pushLabel(): string {
    switch (push.status.kind) {
      case 'idle':
        return 'Tap to enable push notifications';
      case 'unavailable':
        return push.status.reason;
      case 'awaiting-permission':
        return 'Asking for permission…';
      case 'denied':
        return 'Permission denied — enable notifications in system settings, then retry';
      case 'registering':
        return 'Registering with metu…';
      case 'registered':
        return `Registered · ${push.status.token.slice(0, 24)}…`;
      case 'error':
        return `Error: ${push.status.error}`;
    }
  }

  const pushDisabled =
    push.status.kind === 'unavailable' ||
    push.status.kind === 'awaiting-permission' ||
    push.status.kind === 'registering';

  return (
    <View style={s.root}>
      <Text style={s.h}>Settings</Text>

      <Text style={s.label}>API token</Text>
      <TextInput
        style={s.input}
        value={token}
        onChangeText={setLocal}
        placeholder="Paste your metu API token"
        placeholderTextColor="#6b6884"
        autoCapitalize="none"
        secureTextEntry
      />
      <Pressable
        style={s.btn}
        onPress={async () => {
          await setToken(token.trim());
          Alert.alert('Saved');
        }}
      >
        <Text style={s.btnText}>Save</Text>
      </Pressable>
      <Text style={s.muted}>
        Generate one at app.metu.ro/settings — your phone is just another client.
      </Text>

      <View style={s.divider} />

      <Text style={s.label}>Push notifications</Text>
      <Pressable
        style={[s.btn, pushDisabled ? s.btnDisabled : null]}
        onPress={pushDisabled ? undefined : push.register}
        disabled={pushDisabled}
      >
        <Text style={s.btnText}>
          {push.status.kind === 'registered' ? 'Re-register' : 'Enable push'}
        </Text>
      </Pressable>
      <Text style={s.muted}>{pushLabel()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0c0a14', gap: 12 },
  h: { color: '#f5f3ff', fontSize: 24, fontWeight: '700' },
  label: { color: '#a78bfa', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  input: {
    backgroundColor: '#181527',
    color: '#f5f3ff',
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
  },
  btn: { backgroundColor: '#7c3aed', padding: 14, borderRadius: 14, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#3b2f5e' },
  btnText: { color: 'white', fontWeight: '700' },
  muted: { color: '#6b6884', fontSize: 12 },
  divider: { height: 1, backgroundColor: '#181527', marginVertical: 8 },
});
