import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchGoals } from '../api/goals';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function GoalRow({ goal }) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={2}>{goal.title}</Text>
        <StatusBadge status={goal.status} />
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${goal.progress || 0}%` }]} />
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.progressLabel}>{goal.progress || 0}% complete</Text>
        {goal.quarter ? <Text style={styles.quarter}>{goal.quarter}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export default function GoalsScreen({ navigation }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchGoals();
      setGoals(list);
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

  const avgProgress = goals.length
    ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / goals.length)
    : 0;
  const atRiskCount = goals.filter((g) => (g.progress || 0) < 40).length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: goals.length, label: 'Total' },
          { value: `${avgProgress}%`, label: 'Avg progress', color: colors.brand600 },
          { value: atRiskCount, label: 'At risk', color: atRiskCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <FlatList
        data={goals}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <GoalRow goal={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading goals…" />
          ) : (
            <EmptyState
              icon="🎯"
              title="No goals set yet"
              subtitle="Set a goal to track progress toward key outcomes."
              actionLabel="Create Goal"
              onAction={() => navigation.navigate('CreateGoal')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateGoal')} activeOpacity={0.85}>
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
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.gray100, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand500 },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  progressLabel: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600' },
  quarter: { fontSize: fontSize.xs, color: colors.gray400 },
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
