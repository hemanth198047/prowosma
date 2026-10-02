import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchProjects } from '../api/projects';
import { fetchGoals } from '../api/goals';
import { fetchKpis } from '../api/kpis';
import Card from '../components/Card';
import LoadingView from '../components/LoadingView';
import { colors, spacing, fontSize } from '../theme/theme';

// A leadership-style rollup, computed client-side from the same
// endpoints Projects/Goals/KPIs already use — the web app's Executive
// Dashboard pulls in a dedicated portfolio-analytics endpoint too
// (api/analytics.js's getPortfolio) for deeper cross-project rollups;
// this mobile version sticks to what's already fetched elsewhere in the
// app rather than adding a new endpoint for a summary view, since the
// "check the big picture on my phone" use case is well served by this
// without it.
function StatBlock({ value, label, color }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color: color || colors.gray900 }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ExecutiveScreen() {
  const [projects, setProjects] = useState([]);
  const [goals, setGoals] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projList, goalList, kpiList] = await Promise.all([
        fetchProjects(),
        fetchGoals(),
        fetchKpis(),
      ]);
      setProjects(projList);
      setGoals(goalList);
      setKpis(kpiList);
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

  if (loading) {
    return <LoadingView message="Loading overview…" />;
  }

  const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length;
  const avgGoalProgress = goals.length
    ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / goals.length)
    : 0;
  const atRiskGoals = goals.filter((g) => (g.progress || 0) < 40).length;
  const kpiAlerts = kpis.filter((k) => k.alertTriggered).length;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Projects</Text>
        <View style={styles.statsRow}>
          <StatBlock value={projects.length} label="Total" />
          <StatBlock value={activeProjects} label="Active" color={colors.success} />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Goals</Text>
        <View style={styles.statsRow}>
          <StatBlock value={`${avgGoalProgress}%`} label="Avg progress" color={colors.brand600} />
          <StatBlock value={atRiskGoals} label="At risk (<40%)" color={atRiskGoals > 0 ? colors.danger : colors.gray900} />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>KPIs</Text>
        <View style={styles.statsRow}>
          <StatBlock value={kpis.length} label="Tracked" />
          <StatBlock value={kpiAlerts} label="Below threshold" color={kpiAlerts > 0 ? colors.danger : colors.success} />
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
  statBlock: { flex: 1 },
  statValue: { fontSize: fontSize.xxl, fontWeight: '800' },
  statLabel: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600', marginTop: 2 },
});
