import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchSprints } from '../api/sprints';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function formatRange(start, end) {
  if (!start && !end) return null;
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt(start || end);
}

function SprintRow({ sprint, onPress }) {
  const range = formatRange(sprint.startDate, sprint.endDate);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle}>{sprint.name}</Text>
        <StatusBadge status={sprint.status} />
      </View>
      {sprint.goal ? <Text style={styles.goal} numberOfLines={2}>{sprint.goal}</Text> : null}
      <View style={styles.rowMeta}>
        {range ? <Text style={styles.dateRange}>{range}</Text> : null}
        <Text style={styles.taskCount}>{sprint.taskIds?.length || 0} tasks</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function SprintsScreen({ navigation }) {
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchSprints();
      setSprints(list);
    } catch {
      // keep existing list on transient error
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

  const activeCount = sprints.filter((s) => s.status === 'ACTIVE').length;
  const totalTaskCount = sprints.reduce((sum, s) => sum + (s.taskIds?.length || 0), 0);

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: sprints.length, label: 'Total' },
          { value: activeCount, label: 'Active', color: colors.brand600 },
          { value: totalTaskCount, label: 'Tasks in sprints' },
        ]}
      />
      <FlatList
        data={sprints}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SprintRow sprint={item} onPress={() => navigation.navigate('SprintDetail', { sprintId: item.id })} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading sprints…" />
          ) : (
            <EmptyState
              icon="⚡"
              title="No sprints yet"
              subtitle="Plan a sprint to organize your team's work into cycles."
              actionLabel="Create Sprint"
              onAction={() => navigation.navigate('CreateSprint')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateSprint')} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  rowTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  goal: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.sm },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  dateRange: { fontSize: fontSize.xs, color: colors.gray400 },
  taskCount: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '600' },
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
