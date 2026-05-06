import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { getToken, setToken } from '../lib/api';

export default function SettingsScreen() {
  const [token, setLocal] = useState('');
  useEffect(() => {
    getToken().then(setLocal);
  }, []);
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
  btnText: { color: 'white', fontWeight: '700' },
  muted: { color: '#6b6884', fontSize: 12 },
});
