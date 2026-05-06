import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#a78bfa',
          tabBarStyle: { backgroundColor: '#0c0a14', borderTopColor: '#1f1b2e' },
          headerStyle: { backgroundColor: '#0c0a14' },
          headerTintColor: '#f5f3ff',
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Capture' }} />
        <Tabs.Screen name="now" options={{ title: 'Now' }} />
        <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </>
  );
}
