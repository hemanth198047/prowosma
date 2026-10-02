import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { createDecision } from '../api/decisions';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const IMPACTS = ['LOW', 'MEDIUM', 'HIGH'];

export default function CreateDecisionScreen({ navigation }) {
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [decisionText, setDecisionText] = useState('');
  const [impact, setImpact] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the decision a name first.');
      return;
    }
    setSaving(true);
    try {
      await createDecision({
        title: title.trim(),
        context: context.trim(),
        decision: decisionText.trim(),
        impact,
        status: 'OPEN',
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not log the decision.');
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
        placeholder="e.g. Switch to PostgreSQL"
        placeholderTextColor={colors.gray400}
        autoFocus
      />

      <Text style={styles.label}>Impact</Text>
      <View style={styles.chipRow}>
        {IMPACTS.map((i) => (
          <TouchableOpacity key={i} onPress={() => setImpact(i)} style={[styles.chip, impact === i && styles.chipActive]}>
            <Text style={[styles.chipText, impact === i && styles.chipTextActive]}>{i}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Context (optional)</Text>
      <TextInput
        style={styles.textArea}
        value={context}
        onChangeText={setContext}
        placeholder="What led to this decision?"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Decision (optional)</Text>
      <TextInput
        style={styles.textArea}
        value={decisionText}
        onChangeText={setDecisionText}
        placeholder="What was decided?"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={3}
      />

      <Button title="Log Decision" onPress={handleCreate} loading={saving} style={styles.submitBtn} />
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
    minHeight: 70,
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
