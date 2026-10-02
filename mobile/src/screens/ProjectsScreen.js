import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchProjects } from '../api/projects';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function ProjectRow({ project, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.colorBar, { backgroundColor: project.color || colors.brand500 }]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {project.name}
        </Text>
        {project.description ? (
          <Text style={styles.rowDesc} numberOfLines={2}>
            {project.description}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <StatusBadge status={project.status} />
          <Text style={styles.category}>{project.category || 'General'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ProjectsScreen({ navigation }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchProjects();
      setProjects(list);
    } catch {
      // Keep existing list on a transient failure — pull-to-refresh retries.
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

  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;
  const doneCount = projects.filter((p) => p.status === 'DONE').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: projects.length, label: 'Total' },
          { value: activeCount, label: 'Active', color: colors.brand600 },
          { value: doneCount, label: 'Done', color: colors.success },
        ]}
      />
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProjectRow
            project={item}
            onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading projects…" />
          ) : (
            <EmptyState
              icon="📁"
              title="No projects yet"
              subtitle="Create your first project to organize your work."
              actionLabel="Create Project"
              onAction={() => navigation.navigate('CreateProject')}
            />
          )
        }
        initialNumToRender={10}
        removeClippedSubviews
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateProject')}
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
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  colorBar: { width: 5 },
  rowBody: { flex: 1, padding: spacing.md },
  rowTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900, marginBottom: 4 },
  rowDesc: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.sm },
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
