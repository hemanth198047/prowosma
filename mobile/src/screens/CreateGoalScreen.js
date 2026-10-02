import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { createGoal } from '../api/goals';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const LEVELS = ['COMPANY', 'TEAM', 'INDIVIDUAL'];

export default function CreateGoalScreen({ navigation }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('TEAM');
  const [quarter, setQuarter] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the goal a name first.');
      return;
    }
    setSaving(true);
    try {
      await createGoal({
        title: title.trim(),
        description: description.trim(),
        level,
        quarter: quarter.trim(),
        status: 'ACTIVE',
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not create the goal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Goal title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Grow active users by 20%"
        placeholderTextColor={colors.gray400}
        autoFocus
      />

      <Text style={styles.label}>Level</Text>
      <View style={styles.chipRow}>
        {LEVELS.map((l) => (
          <TouchableOpacity
            key={l}
            onPress={() => setLevel(l)}
            style={[styles.chip, level === l && styles.chipActive]}
          >
            <Text style={[styles.chipText, level === l && styles.chipTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Quarter (optional)</Text>
      <TextInput
        style={styles.input}
        value={quarter}
        onChangeText={setQuarter}
        placeholder="e.g. Q1 2026"
        placeholderTextColor={colors.gray400}
      />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={styles.textArea}
        value={description}
        onChangeText={setDescription}
        placeholder="What does success look like?"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={4}
      />

      <Button title="Create Goal" onPress={handleCreate} loading={saving} style={styles.submitBtn} />
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
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.gray900,
    backgroundColor: colors.white,
    minHeight: 90,
    textAlignVertical: 'top',
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
