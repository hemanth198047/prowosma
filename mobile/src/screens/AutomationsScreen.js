import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAutomations, toggleAutomation } from '../api/automations';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// Read + toggle only — building the trigger/condition/action rule editor
// itself (see Automation.java: triggerConfig, conditions, actions are all
// open-ended nested objects/JSON) is a genuinely complex form builder in
// its own right, closer to the BPM Studio canvas than a normal CRUD
// screen. Viewing what exists and turning rules on/off covers the
// highest-value daily interaction without attempting that port.
function AutomationRow({ automation, onToggle }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.name}>{automation.name}</Text>
        {automation.description ? (
          <Text style={styles.desc} numberOfLines={2}>{automation.description}</Text>
        ) : null}
        <Text style={styles.runInfo}>
          Ran {automation.runCount || 0} time{automation.runCount === 1 ? '' : 's'}
          {automation.failCount > 0 ? ` · ${automation.failCount} failed` : ''}
        </Text>
      </View>
      <Switch
        value={automation.enabled}
        onValueChange={() => onToggle(automation)}
        trackColor={{ false: colors.gray200, true: colors.brand400 }}
        thumbColor={colors.white}
      />
    </View>
  );
}

export default function AutomationsScreen() {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchAutomations();
      setAutomations(list);
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

  const onToggle = async (automation) => {
    setAutomations((prev) =>
      prev.map((a) => (a.id === automation.id ? { ...a, enabled: !a.enabled } : a))
    );
    try {
      await toggleAutomation(automation.id);
    } catch {
      Alert.alert('Error', 'Could not toggle that automation.');
      load();
    }
  };

  const activeCount = automations.filter((a) => a.enabled).length;
  const totalRuns = automations.reduce((sum, a) => sum + (a.runCount || 0), 0);

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: automations.length, label: 'Total' },
          { value: activeCount, label: 'Active', color: colors.success },
          { value: totalRuns, label: 'Total runs', color: colors.brand600 },
        ]}
      />
      <FlatList
        style={styles.flex}
        data={automations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AutomationRow automation={item} onToggle={onToggle} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading automations…" />
          ) : (
            <EmptyState
              icon="🤖"
              title="No automations set up yet"
              subtitle="Automations created on the web app will show up here."
            />
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rowBody: { flex: 1 },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  desc: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  runInfo: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 4 },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
