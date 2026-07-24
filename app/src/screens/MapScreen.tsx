import { View, Text, StyleSheet } from 'react-native';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Map</Text>
      <Text style={styles.subtitle}>Landmarks & team locations</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e' },
  subtitle: { fontSize: 16, color: '#666', marginTop: 8 },
});
