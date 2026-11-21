// SentinelUNI móvil (React Native + Expo): login, reporte rápido y seguimiento de incidentes.
// Consume exactamente las mismas rutas del API Gateway que la web.
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Incident, loadToken, login, logout, User } from './api';

const TYPES: Array<[string, string]> = [
  ['phishing', 'Phishing'], ['malware', 'Malware'], ['ransomware', 'Ransomware'],
  ['acceso_no_autorizado', 'Acceso'], ['ddos', 'DDoS'], ['fuga_de_datos', 'Fuga'], ['otro', 'Otro'],
];
const SEV: Record<string, string> = { Baja: '#6fae7c', Media: '#d9b44a', Alta: '#e8833a', 'Crítica': '#e5484d' };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Si hay token guardado, se valida pidiendo la lista (el Gateway responde 401 si expiró)
    loadToken().then(async (t) => {
      if (t) {
        try { await api('/incidents'); setUser({ username: '', name: 'Sesión guardada', role: 'reporter' }); } catch { await logout(); }
      }
      setReady(true);
    });
  }, []);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      {!ready ? <ActivityIndicator color="#35c4a6" style={{ marginTop: 80 }} />
        : user ? <Home user={user} onLogout={async () => { await logout(); setUser(null); }} />
        : <Login onLogin={setUser} />}
    </SafeAreaView>
  );
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('usuario');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <View style={s.card}>
      <Text style={s.brand}>● SentinelUNI</Text>
      <Text style={s.muted}>Mini-SOC · reporte de incidentes</Text>
      <TextInput style={s.input} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Usuario" placeholderTextColor="#8aa0ab" />
      <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" placeholderTextColor="#8aa0ab" />
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable style={s.button} onPress={() => login(username, password).then(onLogin).catch((e: Error) => setError(e.message))}>
        <Text style={s.buttonText}>Ingresar</Text>
      </Pressable>
    </View>
  );
}

function Home({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [items, setItems] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('phishing');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await api<Incident[]>('/incidents')); } catch (e) { setMsg((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  async function report() {
    try {
      const inc = await api<Incident>('/incidents', 'POST', { title, type });
      setMsg(`Registrado ${inc.id}`); setTitle(''); void refresh();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#35c4a6" />}
      ListHeaderComponent={
        <View>
          <View style={s.row}>
            <Text style={s.brand}>● SentinelUNI</Text>
            <Pressable onPress={onLogout}><Text style={s.muted}>Salir {user.name ? `(${user.name})` : ''}</Text></Pressable>
          </View>
          <View style={s.card}>
            <Text style={s.h2}>Reportar incidente</Text>
            <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="¿Qué pasó?" placeholderTextColor="#8aa0ab" />
            <View style={s.chips}>
              {TYPES.map(([k, v]) => (
                <Pressable key={k} onPress={() => setType(k)} style={[s.chip, type === k && s.chipOn]}><Text style={s.chipText}>{v}</Text></Pressable>
              ))}
            </View>
            <Pressable style={s.button} onPress={report}><Text style={s.buttonText}>Reportar</Text></Pressable>
            {!!msg && <Text style={s.muted}>{msg}</Text>}
          </View>
          <Text style={s.h2}>Incidentes</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={s.item}>
          <Text style={s.id}>{item.id} · {item.status}</Text>
          <Text style={s.title}>{item.title}</Text>
          <Text style={[s.sev, { color: SEV[item.severity] ?? '#8aa0ab' }]}>{item.severity}</Text>
        </View>
      )}
      contentContainerStyle={{ padding: 16 }}
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1418' },
  card: { backgroundColor: '#141e24', borderColor: '#24333c', borderWidth: 1, borderRadius: 8, padding: 16, margin: 16 },
  brand: { color: '#e2ebef', fontSize: 20, fontWeight: '700' },
  h2: { color: '#e2ebef', fontSize: 16, fontWeight: '600', marginVertical: 8 },
  muted: { color: '#8aa0ab', marginVertical: 6 },
  error: { color: '#e5484d', marginTop: 6 },
  input: { backgroundColor: '#0f171c', color: '#e2ebef', borderColor: '#24333c', borderWidth: 1, borderRadius: 6, padding: 10, marginTop: 10 },
  button: { backgroundColor: '#35c4a6', borderRadius: 6, padding: 12, marginTop: 14, alignItems: 'center' },
  buttonText: { color: '#062019', fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { borderColor: '#24333c', borderWidth: 1, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  chipOn: { borderColor: '#35c4a6' },
  chipText: { color: '#e2ebef', fontSize: 12 },
  item: { backgroundColor: '#141e24', borderColor: '#24333c', borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8 },
  id: { color: '#8aa0ab', fontSize: 12 },
  title: { color: '#e2ebef', fontSize: 15, fontWeight: '600', marginVertical: 2 },
  sev: { fontWeight: '700', fontSize: 12 },
});
