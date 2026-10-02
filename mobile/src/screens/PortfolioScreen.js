import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, SectionList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchProgrammes, fetchInitiatives } from '../api/portfolio';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// Read-only for now — Programmes and Initiatives both carry milestone/
// linked-project/linked-goal lists that would need their own pickers to
// create properly; viewing portfolio-level status at a glance (which is
// the actual "check on my phone" use case for this page) doesn't need
// that yet.
function ProgrammeRow({ item }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
        <StatusBadge status={item.status} />
      </View>
      {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
      <Text style={styles.meta}>{(item.projectIds || []).length} projects</Text>
    </View>
  );
}

function InitiativeRow({ item }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
        <StatusBadge status={item.status} />
      </View>
      {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${item.progress || 0}%` }]} />
      </View>
      <Text style={styles.meta}>{item.progress || 0}% · {item.priority} priority</Text>
    </View>
  );
}

export default function PortfolioScreen() {
  const [programmes, setProgrammes] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [progList, initList] = await Promise.all([fetchProgrammes(), fetchInitiatives()]);
      setProgrammes(progList);
      setInitiatives(initList);
    } catch {
      // keep existing lists on transient error
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

  const sections = [
    { title: 'Programmes', data: programmes, kind: 'programme' },
    { title: 'Initiatives', data: initiatives, kind: 'initiative' },
  ];

  const avgInitiativeProgress = initiatives.length
    ? Math.round(initiatives.reduce((sum, i) => sum + (i.progress || 0), 0) / initiatives.length)
    : 0;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: programmes.length, label: 'Programmes' },
          { value: initiatives.length, label: 'Initiatives' },
          { value: `${avgInitiativeProgress}%`, label: 'Avg progress', color: colors.brand600 },
        ]}
      />
      <SectionList
        style={styles.flex}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item, section }) =>
          section.kind === 'programme' ? <ProgrammeRow item={item} /> : <InitiativeRow item={item} />
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderSectionFooter={({ section }) =>
          !loading && section.data.length === 0 ? (
            <Text style={styles.emptyText}>No {section.title.toLowerCase()} yet</Text>
          ) : null
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  sectionHeader: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  desc: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.sm },
  meta: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '600', marginTop: 4 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.gray100, overflow: 'hidden', marginTop: spacing.xs },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: colors.brand500 },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm, marginBottom: spacing.md },
});
