import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getUsage } from '../api/admin';
import Card from '../components/Card';
import LoadingView from '../components/LoadingView';
import { colors, spacing, fontSize } from '../theme/theme';

// Read-only usage stats only — AdminController also covers security
// policy, DLP policy, IP allowlists, data retention, and email
// suppressions. Those are exactly the kind of sensitive, high-blast-radius
// settings that deserve deliberate, careful editing on a full screen with
// no fat-finger risk, not a quick mobile toggle — this app intentionally
// stops at "view usage," not "reconfigure security."
function StatTile({ value, label }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AdminUsageScreen() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getUsage();
      setUsage(res.data);
    } catch {
      // keep existing data on transient error
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

  if (loading || !usage) {
    return <LoadingView message="Loading usage…" />;
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Workspace contents</Text>
        <View style={styles.statsRow}>
          <StatTile value={usage.tasks ?? 0} label="Tasks" />
          <StatTile value={usage.projects ?? 0} label="Projects" />
          <StatTile value={usage.docs ?? 0} label="Docs" />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Active users</Text>
        <View style={styles.statsRow}>
          <StatTile value={usage.dau ?? 0} label="Today" />
          <StatTile value={usage.wau ?? 0} label="This week" />
          <StatTile value={usage.mau ?? 0} label="This month" />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  card: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  statsRow: { flexDirection: 'row' },
  statTile: { flex: 1 },
  statValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900 },
  statLabel: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600', marginTop: 2 },
});
