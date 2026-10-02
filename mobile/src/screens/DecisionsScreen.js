import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchDecisions } from '../api/decisions';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function DecisionRow({ decision }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={2}>{decision.title}</Text>
        <StatusBadge status={decision.status} />
      </View>
      {decision.decision ? <Text style={styles.decisionText} numberOfLines={3}>{decision.decision}</Text> : null}
      <View style={styles.rowMeta}>
        <StatusBadge status={decision.impact} />
        {decision.category ? <Text style={styles.category}>{decision.category}</Text> : null}
      </View>
    </View>
  );
}

export default function DecisionsScreen({ navigation }) {
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchDecisions();
      setDecisions(list);
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

  const openCount = decisions.filter((d) => d.status === 'OPEN').length;
  const highImpactCount = decisions.filter((d) => d.impact === 'HIGH').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: decisions.length, label: 'Total' },
          { value: openCount, label: 'Open', color: colors.warning },
          { value: highImpactCount, label: 'High impact', color: highImpactCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <FlatList
        data={decisions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DecisionRow decision={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading decisions…" />
          ) : (
            <EmptyState
              icon="⚖️"
              title="No decisions logged yet"
              subtitle="Log a decision to keep a record of what was decided and why."
              actionLabel="Log Decision"
              onAction={() => navigation.navigate('CreateDecision')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateDecision')} activeOpacity={0.85}>
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
  decisionText: { fontSize: fontSize.sm, color: colors.gray700, marginBottom: spacing.sm },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  category: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '600' },
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
