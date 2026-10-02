import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchRaidEntries } from '../api/raid';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const TYPES = [
  { key: 'ALL', label: 'All' },
  { key: 'RISK', label: 'Risks' },
  { key: 'ASSUMPTION', label: 'Assumptions' },
  { key: 'ISSUE', label: 'Issues' },
  { key: 'DEPENDENCY', label: 'Dependencies' },
];

const TYPE_ICON = { RISK: '⚠️', ASSUMPTION: '🤔', ISSUE: '🔥', DEPENDENCY: '🔗' };

function RaidRow({ entry }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.typeIcon}>{TYPE_ICON[entry.type] || '•'}</Text>
        <Text style={styles.rowTitle} numberOfLines={2}>{entry.title}</Text>
        <StatusBadge status={entry.status} />
      </View>
      {entry.description ? <Text style={styles.desc} numberOfLines={2}>{entry.description}</Text> : null}
      <View style={styles.rowMeta}>
        <StatusBadge status={entry.impact} />
        {entry.owner ? <Text style={styles.owner}>{entry.owner}</Text> : null}
      </View>
    </View>
  );
}

export default function RaidScreen({ navigation }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchRaidEntries();
      setEntries(list);
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

  const filtered = filter === 'ALL' ? entries : entries.filter((e) => e.type === filter);
  const openCount = entries.filter((e) => e.status === 'OPEN').length;
  const highImpactCount = entries.filter((e) => e.impact === 'HIGH').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: entries.length, label: 'Total' },
          { value: openCount, label: 'Open', color: colors.warning },
          { value: highImpactCount, label: 'High impact', color: highImpactCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={TYPES}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
              onPress={() => setFilter(item.key)}
            >
              <Text style={[styles.filterChipText, filter === item.key && styles.filterChipTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RaidRow entry={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading RAID log…" />
          ) : (
            <EmptyState
              icon="⚠️"
              title="No entries yet"
              subtitle="Log a risk, assumption, issue, or dependency to keep track of it."
              actionLabel="Add Entry"
              onAction={() => navigation.navigate('CreateRaidEntry')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateRaidEntry')} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  filterRow: {
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
    marginRight: spacing.sm,
  },
  filterChipActive: { backgroundColor: colors.brand500 },
  filterChipText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.gray500 },
  filterChipTextActive: { color: colors.white },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  typeIcon: { fontSize: fontSize.md },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  desc: { fontSize: fontSize.sm, color: colors.gray700, marginBottom: spacing.sm },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  owner: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '600' },
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
