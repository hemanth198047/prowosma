import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { fetchTasks, patchTask } from '../api/tasks';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'TODO', label: 'To Do' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'DONE', label: 'Done' },
];

function TaskRow({ task, onToggleDone, onPress }) {
  const isDone = task.status === 'DONE';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <TouchableOpacity
        onPress={(e) => { e.stopPropagation(); onToggleDone(task); }}
        style={[styles.checkbox, isDone && styles.checkboxChecked]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={isDone ? 'Mark as not done' : 'Mark as done'}
      >
        {isDone && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.rowMeta}>
          <StatusBadge status={task.priority} />
          {task.dueDate ? (
            <Text style={styles.dueDate}>Due {new Date(task.dueDate).toLocaleDateString()}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function TasksScreen({ navigation }) {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchTasks({ limit: 100 });
      setTasks(list);
    } catch {
      // Keep whatever's already on screen rather than blanking it on a
      // transient network error — a pull-to-refresh retry is one gesture
      // away.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const onToggleDone = async (task) => {
    const nextStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Optimistic update — flip it locally first so tapping feels instant,
    // then reconcile with the server; on failure just reload for truth.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      await patchTask(task.id, { status: nextStatus });
    } catch {
      load();
    }
  };

  const filtered = filter === 'ALL' ? tasks : tasks.filter((t) => t.status === filter);
  const overdueCount = tasks.filter(
    (t) => t.dueDate && t.status !== 'DONE' && new Date(t.dueDate) < new Date()
  ).length;
  const doneCount = tasks.filter((t) => t.status === 'DONE').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: tasks.length, label: 'Total' },
          { value: doneCount, label: 'Done', color: colors.success },
          { value: overdueCount, label: 'Overdue', color: overdueCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            onToggleDone={onToggleDone}
            onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading tasks…" />
          ) : (
            <EmptyState
              icon="✅"
              title={filter === 'ALL' ? 'No tasks yet' : `No ${filter.toLowerCase().replace('_', ' ')} tasks`}
              subtitle={filter === 'ALL' ? 'Create your first task to get started.' : undefined}
              actionLabel={filter === 'ALL' ? 'Create Task' : undefined}
              onAction={filter === 'ALL' ? () => navigation.navigate('CreateTask') : undefined}
            />
          )
        }
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateTask')}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Create new task"
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.gray100,
  },
  filterChipActive: { backgroundColor: colors.brand500 },
  filterChipText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.gray500 },
  filterChipTextActive: { color: colors.white },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: colors.white, fontSize: fontSize.xs, fontWeight: '800' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray900, marginBottom: 6 },
  rowTitleDone: { textDecorationLine: 'line-through', color: colors.gray400 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dueDate: { fontSize: fontSize.xs, color: colors.gray500 },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand500,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: colors.white, fontSize: 28, fontWeight: '600', marginTop: -2 },
});
