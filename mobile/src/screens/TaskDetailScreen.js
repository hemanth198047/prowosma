import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTask, patchTask, deleteTask, addTimeLog } from '../api/tasks';
import { fetchTeamMembers } from '../api/team';
import Button from '../components/Button';
import LoadingView from '../components/LoadingView';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

// Same "YYYY-MM-DD" text-input approach as CreateSprintScreen — see that
// file's comment for why this isn't a native date picker yet.
function toIsoDateTime(value) {
  if (!value.trim()) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${value.trim()}T00:00:00`;
}

function toDateInputValue(isoString) {
  if (!isoString) return '';
  return isoString.slice(0, 10);
}

function ChipRow({ options, value, onChange }) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          onPress={() => onChange(opt)}
          style={[styles.chip, value === opt && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === opt && styles.chipTextActive]}>
            {opt.replace('_', ' ')}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function TaskDetailScreen({ route, navigation }) {
  const { taskId } = route.params;
  const [task, setTask] = useState(null);
  const [description, setDescription] = useState('');
  const [dueDateInput, setDueDateInput] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [minutesInput, setMinutesInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, members] = await Promise.all([
        getTask(taskId),
        fetchTeamMembers().catch(() => []),
      ]);
      setTask(res.data);
      setDescription(res.data.description || '');
      setDueDateInput(toDateInputValue(res.data.dueDate));
      setTeamMembers(members);
    } catch {
      Alert.alert('Error', "Couldn't load this task.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const updateField = async (field, value) => {
    setTask((prev) => ({ ...prev, [field]: value }));
    setSaving(true);
    try {
      await patchTask(taskId, { [field]: value });
    } catch {
      Alert.alert('Error', 'Could not save that change. Pull to refresh and try again.');
      load();
    } finally {
      setSaving(false);
    }
  };

  const saveDescription = async () => {
    setSaving(true);
    try {
      await patchTask(taskId, { description });
    } catch {
      Alert.alert('Error', 'Could not save the description.');
    } finally {
      setSaving(false);
    }
  };

  const saveDueDate = async () => {
    if (dueDateInput.trim() && !toIsoDateTime(dueDateInput)) {
      Alert.alert('Invalid date', 'Use the format YYYY-MM-DD, e.g. 2026-09-20.');
      setDueDateInput(toDateInputValue(task.dueDate));
      return;
    }
    setSaving(true);
    try {
      const iso = toIsoDateTime(dueDateInput);
      await patchTask(taskId, { dueDate: iso });
      setTask((prev) => ({ ...prev, dueDate: iso }));
    } catch {
      Alert.alert('Error', 'Could not save the due date.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAssignee = async (memberId) => {
    const current = task.assigneeIds || [];
    const next = current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId];
    setTask((prev) => ({ ...prev, assigneeIds: next }));
    setSaving(true);
    try {
      await patchTask(taskId, { assigneeIds: next });
    } catch {
      Alert.alert('Error', 'Could not update assignees.');
      load();
    } finally {
      setSaving(false);
    }
  };

  const logTime = async () => {
    const minutes = parseInt(minutesInput, 10);
    if (!minutes || minutes <= 0) {
      Alert.alert('Enter minutes', 'How many minutes did you spend? e.g. 30');
      return;
    }
    setSaving(true);
    try {
      const res = await addTimeLog(taskId, { minutes });
      setTask(res.data);
      setMinutesInput('');
    } catch {
      Alert.alert('Error', 'Could not log time for this task.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete task?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask(taskId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete this task.');
          }
        },
      },
    ]);
  };

  if (loading || !task) {
    return <LoadingView message="Loading task…" />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{task.title}</Text>
      {saving && <Text style={styles.savingLabel}>Saving…</Text>}

      <Text style={styles.label}>Status</Text>
      <ChipRow options={STATUSES} value={task.status} onChange={(v) => updateField('status', v)} />

      <Text style={styles.label}>Priority</Text>
      <ChipRow options={PRIORITIES} value={task.priority} onChange={(v) => updateField('priority', v)} />

      <Text style={styles.label}>Due date</Text>
      <TextInput
        style={styles.input}
        value={dueDateInput}
        onChangeText={setDueDateInput}
        onBlur={saveDueDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.gray400}
        keyboardType="numbers-and-punctuation"
      />

      {teamMembers.length > 0 && (
        <>
          <Text style={styles.label}>Assignees</Text>
          <View style={styles.chipRow}>
            {teamMembers.map((m) => {
              const active = (task.assigneeIds || []).includes(m.id);
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => toggleAssignee(m.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.textArea}
        value={description}
        onChangeText={setDescription}
        onBlur={saveDescription}
        placeholder="Add a description…"
        placeholderTextColor={colors.gray400}
        multiline
        numberOfLines={5}
      />

      {task.tags?.length > 0 && (
        <>
          <Text style={styles.label}>Tags</Text>
          <View style={styles.chipRow}>
            {task.tags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Time logged</Text>
      {(task.timeLogs || []).length > 0 ? (
        <Text style={styles.value}>
          {task.timeLogs.reduce((sum, t) => sum + (t.minutes || 0), 0)} minutes total
        </Text>
      ) : (
        <Text style={styles.dim}>No time logged yet</Text>
      )}
      <View style={styles.logTimeRow}>
        <TextInput
          style={[styles.input, styles.logTimeInput]}
          value={minutesInput}
          onChangeText={setMinutesInput}
          placeholder="Minutes"
          placeholderTextColor={colors.gray400}
          keyboardType="number-pad"
        />
        <Button title="Log Time" onPress={logTime} style={styles.logTimeBtn} />
      </View>

      <Button title="Delete task" variant="danger" onPress={confirmDelete} style={styles.deleteBtn} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900, marginBottom: spacing.xs },
  savingLabel: { fontSize: fontSize.xs, color: colors.brand500, marginBottom: spacing.md },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  value: { fontSize: fontSize.md, color: colors.gray900 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
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
  tagChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brand50,
  },
  tagChipText: { fontSize: fontSize.xs, color: colors.brand600, fontWeight: '600' },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.gray900,
    backgroundColor: colors.white,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  deleteBtn: { marginTop: spacing.xxl, borderColor: colors.danger },
  logTimeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' },
  logTimeInput: { flex: 1, height: 44 },
  logTimeBtn: { flex: 1, height: 44 },
});
