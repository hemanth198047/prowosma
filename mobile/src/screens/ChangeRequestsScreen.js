import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchChangeRequests } from '../api/changeRequests';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function ChangeRow({ cr }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={2}>{cr.title}</Text>
        <StatusBadge status={cr.status} />
      </View>
      {cr.description ? <Text style={styles.desc} numberOfLines={2}>{cr.description}</Text> : null}
      <View style={styles.rowMeta}>
        <StatusBadge status={cr.impact} />
        {cr.category ? <Text style={styles.category}>{cr.category}</Text> : null}
      </View>
    </View>
  );
}

export default function ChangeRequestsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchChangeRequests();
      setItems(list);
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

  const draftCount = items.filter((i) => i.status === 'DRAFT').length;
  const highImpactCount = items.filter((i) => i.impact === 'HIGH').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: items.length, label: 'Total' },
          { value: draftCount, label: 'Draft' },
          { value: highImpactCount, label: 'High impact', color: highImpactCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ChangeRow cr={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading change requests…" />
          ) : (
            <EmptyState
              icon="📝"
              title="No change requests yet"
              subtitle="Submit a change request to track scope, budget, or timeline changes."
              actionLabel="New Change Request"
              onAction={() => navigation.navigate('CreateChangeRequest')}
            />
          )
        }
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateChangeRequest')}
        activeOpacity={0.85}
      >
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
  desc: { fontSize: fontSize.sm, color: colors.gray700, marginBottom: spacing.sm },
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
