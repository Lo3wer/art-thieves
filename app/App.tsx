import { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  Button,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { API_BASE } from './api';

type Heist = {
  id: number;
  title: string;
  location: string;
  date: string;
};

type HeistInput = {
  title: string;
  location: string;
  date: string;
};

export default function App() {
  const [heists, setHeists] = useState<Heist[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<HeistInput>({ title: '', location: '', date: '' });

  const fetchHeists = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/heists`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHeists(await res.json());
    } catch (err) {
      Alert.alert('Error', 'Could not fetch heists. Is the server running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHeists();
  }, [fetchHeists]);

  const addHeist = async () => {
    if (!form.title || !form.location || !form.date) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/heists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm({ title: '', location: '', date: '' });
      fetchHeists();
    } catch {
      Alert.alert('Error', 'Could not add heist.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading heists...</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Vancouver Art Thieves</Text>

      <Text style={styles.sectionTitle}>Known Heists</Text>
      <FlatList
        data={heists}
        keyExtractor={(item) => item.id.toString()}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.heistCard}>
            <Text style={styles.heistTitle}>{item.title}</Text>
            <Text style={styles.heistDetail}>{item.location}</Text>
            <Text style={styles.heistDetail}>{item.date}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No heists yet.</Text>}
      />

      <Text style={styles.sectionTitle}>Report a Heist</Text>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Title"
          value={form.title}
          onChangeText={(title) => setForm((f) => ({ ...f, title }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Location"
          value={form.location}
          onChangeText={(location) => setForm((f) => ({ ...f, location }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Date (YYYY-MM-DD)"
          value={form.date}
          onChangeText={(date) => setForm((f) => ({ ...f, date }))}
        />
        <Button title="Add Heist" onPress={addHeist} />
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  header: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 20, textAlign: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 10 },
  list: { flex: 1, marginBottom: 20 },
  heistCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  heistTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a2e', marginBottom: 4 },
  heistDetail: { fontSize: 14, color: '#555' },
  empty: { textAlign: 'center', color: '#999', marginTop: 20 },
  form: { marginBottom: 30 },
  input: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 15,
  },
});
