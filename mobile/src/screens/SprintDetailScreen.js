import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSprint, fetchSprintTasks, deleteSprint } from '../api/sprints';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import LoadingView from '../components/LoadingView';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function StatTile({ label, value, color }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, { color: color || colors.gray900 }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function TaskRow({ task, onPress }) {
  return (
    <TouchableOpacity style={styles.taskRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
      <StatusBadge status={task.status} />
    </TouchableOpacity>
  );
}

export default function SprintDetailScreen({ route, navigation }) {
  const { sprintId } = route.params;
  const [sprint, setSprint] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sprintRes, taskList] = await Promise.all([
        getSprint(sprintId),
        fetchSprintTasks(sprintId),
      ]);
      setSprint(sprintRes.data);
      setTasks(taskList);
    } catch {
      Alert.alert('Error', "Couldn't load this sprint.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sprintId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const confirmDelete = () => {
    Alert.alert('Delete sprint?', 'Tasks inside it will not be deleted, but will be removed from this sprint.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSprint(sprintId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete this sprint.');
          }
        },
      },
    ]);
  };

  if (loading || !sprint) {
    return <LoadingView message="Loading sprint…" />;
  }

  const todo = tasks.filter((t) => t.status === 'TODO').length;
  const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const done = tasks.filter((t) => t.status === 'DONE').length;

  return (
    <FlatList
      style={styles.flex}
      data={tasks}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>{sprint.name}</Text>
            <StatusBadge status={sprint.status} />
          </View>
          {sprint.goal ? <Text style={styles.goal}>{sprint.goal}</Text> : null}

          <View style={styles.statsRow}>
            <StatTile label="To Do" value={todo} />
            <StatTile label="In Progress" value={inProgress} color={colors.warning} />
            <StatTile label="Done" value={done} color={colors.success} />
          </View>

          <Text style={styles.sectionLabel}>Tasks in this sprint</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TaskRow task={item} onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })} />
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>No tasks in this sprint yet</Text>}
      ListFooterComponent={
        <Button title="Delete sprint" variant="danger" onPress={confirmDelete} style={styles.deleteBtn} />
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.md },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900, flex: 1, marginRight: spacing.sm },
  goal: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.md },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  statTile: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.xl, fontWeight: '800' },
  statLabel: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600', marginTop: 2 },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  taskTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.gray900 },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.lg },
  deleteBtn: { marginTop: spacing.xl, borderColor: colors.danger },
});
