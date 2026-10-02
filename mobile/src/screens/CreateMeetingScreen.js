import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Alert } from 'react-native';
import { createMeeting } from '../api/meetings';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// Same plain-text date+time approach used elsewhere in this app (see
// CreateSprintScreen's comment) — no native date-picker dependency yet.
function toIsoDateTime(dateStr, timeStr) {
  if (!dateStr.trim()) return null;
  const dateMatch = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;
  const time = timeStr.trim().match(/^(\d{2}):(\d{2})$/) ? timeStr.trim() : '09:00';
  return `${dateStr.trim()}T${time}:00`;
}

export default function CreateMeetingScreen({ navigation }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the meeting a name first.');
      return;
    }
    if (date.trim() && !toIsoDateTime(date, time)) {
      Alert.alert('Invalid date', 'Use the format YYYY-MM-DD, e.g. 2026-09-20.');
      return;
    }
    setSaving(true);
    try {
      await createMeeting({
        title: title.trim(),
        description: description.trim(),
        meetingDate: toIsoDateTime(date, time),
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not create the meeting.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Meeting title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Sprint Planning"
        placeholderTextColor={colors.gray400}
        autoFocus
      />

      <Text style={styles.label}>Date (optional)</Text>
      <TextInput
        style={styles.input}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.gray400}
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.label}>Time (optional, 24h)</Text>
      <TextInput
        style={styles.input}
        value={time}
        onChangeText={setTime}
        placeholder="HH:MM, e.g. 14:30"
        placeholderTextColor={colors.gray400}
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={styles.textArea}
        value={description}
        onChangeText={setDescription}
        placeholder="What's this meeting about?"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={4}
      />

      <Button title="Create Meeting" onPress={handleCreate} loading={saving} style={styles.submitBtn} />
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
  submitBtn: { marginTop: spacing.xxl },
});
