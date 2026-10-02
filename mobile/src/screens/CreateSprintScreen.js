import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Alert } from 'react-native';
import { createSprint } from '../api/sprints';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// Parses "YYYY-MM-DD" into a full ISO datetime string the backend's
// LocalDateTime fields expect. No native date-picker dependency — plain
// text keeps this screen free of any extra native module to link, at the
// cost of the user typing the format correctly; a real picker
// (@react-native-community/datetimepicker) is a reasonable upgrade once
// this is running on an actual device to verify the picker UI on both
// platforms.
function toIsoDateTime(value) {
  if (!value.trim()) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${value.trim()}T00:00:00`;
}

export default function CreateSprintScreen({ navigation }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the sprint a name first.');
      return;
    }
    if (startDate.trim() && !toIsoDateTime(startDate)) {
      Alert.alert('Invalid start date', 'Use the format YYYY-MM-DD, e.g. 2026-09-20.');
      return;
    }
    if (endDate.trim() && !toIsoDateTime(endDate)) {
      Alert.alert('Invalid end date', 'Use the format YYYY-MM-DD, e.g. 2026-10-04.');
      return;
    }
    setSaving(true);
    try {
      await createSprint({
        name: name.trim(),
        goal: goal.trim(),
        startDate: toIsoDateTime(startDate),
        endDate: toIsoDateTime(endDate),
        status: 'PLANNING',
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not create the sprint.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Sprint name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Sprint 12"
        placeholderTextColor={colors.gray400}
        autoFocus
      />

      <Text style={styles.label}>Sprint goal (optional)</Text>
      <TextInput
        style={styles.textArea}
        value={goal}
        onChangeText={setGoal}
        placeholder="What should this sprint achieve?"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Start date (optional)</Text>
      <TextInput
        style={styles.input}
        value={startDate}
        onChangeText={setStartDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.gray400}
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.label}>End date (optional)</Text>
      <TextInput
        style={styles.input}
        value={endDate}
        onChangeText={setEndDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.gray400}
        keyboardType="numbers-and-punctuation"
      />

      <Button title="Create Sprint" onPress={handleCreate} loading={saving} style={styles.submitBtn} />
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
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitBtn: { marginTop: spacing.xxl },
});
