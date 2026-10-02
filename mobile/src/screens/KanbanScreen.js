import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchTasks, patchTask } from '../api/tasks';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const COLUMNS = [
  { key: 'TODO', label: 'To Do' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'DONE', label: 'Done' },
];

// A column is most of the screen width but peeks the next one, so it's
// obvious there's more to scroll to — a common, discoverable pattern for
// horizontal paging on phones.
const COLUMN_WIDTH = Dimensions.get('window').width * 0.82;

function TaskCard({ task, onMove, columnKey }) {
  const currentIndex = COLUMNS.findIndex((c) => c.key === columnKey);
  const prevColumn = COLUMNS[currentIndex - 1];
  const nextColumn = COLUMNS[currentIndex + 1];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={3}>{task.title}</Text>
      <View style={styles.cardMeta}>
        <StatusBadge status={task.priority} />
      </View>
      <View style={styles.moveRow}>
        {prevColumn ? (
          <TouchableOpacity style={styles.moveBtn} onPress={() => onMove(task, prevColumn.key)}>
            <Text style={styles.moveBtnText}>← {prevColumn.label}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.moveSpacer} />
        )}
        {nextColumn ? (
          <TouchableOpacity style={styles.moveBtn} onPress={() => onMove(task, nextColumn.key)}>
            <Text style={styles.moveBtnText}>{nextColumn.label} →</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.moveSpacer} />
        )}
      </View>
    </View>
  );
}

export default function KanbanScreen({ navigation }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchTasks({ limit: 200 });
      setTasks(list);
    } catch {
      // keep existing board on a transient error
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

  const onMove = async (task, newStatus) => {
    // Optimistic update — same pattern as the Tasks list's done toggle.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)));
    try {
      await patchTask(task.id, { status: newStatus });
    } catch {
      load();
    }
  };

  if (loading) {
    return <LoadingView message="Loading board…" />;
  }

  const highPriorityCount = tasks.filter((t) => t.priority === 'HIGH').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: tasks.length, label: 'Total' },
          { value: tasks.filter((t) => t.status === 'DONE').length, label: 'Done', color: colors.success },
          { value: highPriorityCount, label: 'High priority', color: highPriorityCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <ScrollView
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.flex}
        contentContainerStyle={styles.boardContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <View key={col.key} style={[styles.column, { width: COLUMN_WIDTH }]}>
              <View style={styles.columnHeader}>
                <Text style={styles.columnTitle}>{col.label}</Text>
                <View style={styles.columnCount}>
                  <Text style={styles.columnCountText}>{colTasks.length}</Text>
                </View>
              </View>
              <ScrollView style={styles.columnScroll} showsVerticalScrollIndicator={false}>
                {colTasks.length === 0 ? (
                  <Text style={styles.emptyText}>No tasks here</Text>
                ) : (
                  colTasks.map((task) => (
                    <TouchableOpacity
                      key={task.id}
                      onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
                      activeOpacity={0.8}
                    >
                      <TaskCard task={task} columnKey={col.key} onMove={onMove} />
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  boardContent: { padding: spacing.md },
  column: {
    backgroundColor: colors.gray100,
    borderRadius: radius.lg,
    marginRight: spacing.md,
    padding: spacing.sm,
    maxHeight: '100%',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  columnTitle: { fontSize: fontSize.sm, fontWeight: '800', color: colors.gray700 },
  columnCount: {
    backgroundColor: colors.white,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  columnCountText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.gray500 },
  columnScroll: { flex: 1 },
  emptyText: { color: colors.gray400, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.lg },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.gray900, marginBottom: spacing.sm },
  cardMeta: { flexDirection: 'row', marginBottom: spacing.sm },
  moveRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  moveBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.brand50,
    alignItems: 'center',
  },
  moveBtnText: { fontSize: 10, fontWeight: '700', color: colors.brand600 },
  moveSpacer: { flex: 1 },
});
