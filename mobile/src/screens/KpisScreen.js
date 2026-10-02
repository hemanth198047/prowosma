import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchKpis } from '../api/kpis';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function KpiRow({ kpi }) {
  const pct = kpi.targetValue ? Math.min(100, Math.round((kpi.currentValue / kpi.targetValue) * 100)) : 0;
  const isAlert = kpi.alertTriggered;
  return (
    <View style={[styles.row, isAlert && styles.rowAlert]}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>{kpi.name}</Text>
        <StatusBadge status={kpi.status} />
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.currentValue}>
          {kpi.currentValue}{kpi.unit} <Text style={styles.dim}>/ {kpi.targetValue}{kpi.unit} target</Text>
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }, isAlert && styles.progressFillAlert]} />
      </View>
      {isAlert && <Text style={styles.alertText}>⚠ Below alert threshold</Text>}
    </View>
  );
}

export default function KpisScreen() {
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchKpis();
      setKpis(list);
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

  const alertCount = kpis.filter((k) => k.alertTriggered).length;
  const onTrackCount = kpis.length - alertCount;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: kpis.length, label: 'Tracked' },
          { value: onTrackCount, label: 'On track', color: colors.success },
          { value: alertCount, label: 'Below target', color: alertCount > 0 ? colors.danger : colors.gray900 },
        ]}
      />
      <FlatList
        style={styles.flex}
        data={kpis}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <KpiRow kpi={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading KPIs…" />
          ) : (
            <EmptyState icon="📈" title="No KPIs tracked yet" subtitle="KPIs set up on the web app will show up here." />
          )
        }
      />
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
  rowAlert: { borderColor: colors.danger },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  valueRow: { marginBottom: spacing.sm },
  currentValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.gray900 },
  dim: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '500' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.gray100, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand500 },
  progressFillAlert: { backgroundColor: colors.danger },
  alertText: { fontSize: fontSize.xs, color: colors.danger, fontWeight: '600', marginTop: spacing.xs },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
