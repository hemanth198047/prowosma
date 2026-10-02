import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { createTask } from '../api/tasks';
import { fetchProjects } from '../api/projects';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

export default function CreateTaskScreen({ navigation, route }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(route.params?.projectId || null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the task a name first.');
      return;
    }
    setSaving(true);
    try {
      await createTask({ title: title.trim(), priority, projectId, status: 'TODO' });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not create the task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="What needs doing?"
        placeholderTextColor={colors.gray400}
        autoFocus
      />

      <Text style={styles.label}>Priority</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <TouchableOpacity
            key={p}
            onPress={() => setPriority(p)}
            style={[styles.chip, priority === p && styles.chipActive]}
          >
            <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {projects.length > 0 && (
        <>
          <Text style={styles.label}>Project (optional)</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              onPress={() => setProjectId(null)}
              style={[styles.chip, !projectId && styles.chipActive]}
            >
              <Text style={[styles.chipText, !projectId && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
            {projects.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, projectId === p.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Button title="Create Task" onPress={handleCreate} loading={saving} style={styles.submitBtn} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    color: colors.gray900,
    backgroundColor: colors.white,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand500, borderColor: colors.brand500 },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray700 },
  chipTextActive: { color: colors.white },
  submitBtn: { marginTop: spacing.xxl },
});
