import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { createRaidEntry } from '../api/raid';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const TYPES = ['RISK', 'ASSUMPTION', 'ISSUE', 'DEPENDENCY'];
const IMPACTS = ['LOW', 'MEDIUM', 'HIGH'];

export default function CreateRaidEntryScreen({ navigation }) {
  const [type, setType] = useState('RISK');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give this entry a title first.');
      return;
    }
    setSaving(true);
    try {
      await createRaidEntry({ type, title: title.trim(), description: description.trim(), impact });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not create this entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Type</Text>
      <View style={styles.chipRow}>
        {TYPES.map((t) => (
          <TouchableOpacity key={t} onPress={() => setType(t)} style={[styles.chip, type === t && styles.chipActive]}>
            <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Vendor contract renewal delayed"
        placeholderTextColor={colors.gray400}
      />

      <Text style={styles.label}>Impact</Text>
      <View style={styles.chipRow}>
        {IMPACTS.map((i) => (
          <TouchableOpacity key={i} onPress={() => setImpact(i)} style={[styles.chip, impact === i && styles.chipActive]}>
            <Text style={[styles.chipText, impact === i && styles.chipTextActive]}>{i}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={styles.textArea}
        value={description}
        onChangeText={setDescription}
        placeholder="More detail…"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={4}
      />

      <Button title="Add Entry" onPress={handleCreate} loading={saving} style={styles.submitBtn} />
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
