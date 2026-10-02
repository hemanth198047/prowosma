import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getProject, deleteProject } from '../api/projects';
import { fetchTasks } from '../api/tasks';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import LoadingView from '../components/LoadingView';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function TaskRow({ task, onPress }) {
  return (
    <TouchableOpacity style={styles.taskRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
      <StatusBadge status={task.status} />
    </TouchableOpacity>
  );
}

export default function ProjectDetailScreen({ route, navigation }) {
  const { projectId } = route.params;
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projRes, taskList] = await Promise.all([
        getProject(projectId),
        fetchTasks({ projectId }),
      ]);
      setProject(projRes.data);
      setTasks(taskList.filter((t) => t.projectId === projectId));
    } catch {
      Alert.alert('Error', "Couldn't load this project.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const confirmDelete = () => {
    Alert.alert('Delete project?', 'Tasks inside it will not be deleted, but will lose their project link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProject(projectId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete this project.');
          }
        },
      },
    ]);
  };

  if (loading || !project) {
    return <LoadingView message="Loading project…" />;
  }

  const done = tasks.filter((t) => t.status === 'DONE').length;

  return (
    <FlatList
      style={styles.flex}
      data={tasks}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={[styles.colorBar, { backgroundColor: project.color || colors.brand500 }]} />
          <Text style={styles.title}>{project.name}</Text>
          {project.description ? <Text style={styles.desc}>{project.description}</Text> : null}
          <StatusBadge status={project.status} />
          <Text style={styles.taskCount}>
            {done}/{tasks.length} tasks done
          </Text>
          <Button
            title="+ New Task in this Project"
            variant="secondary"
            onPress={() => navigation.navigate('CreateTask', { projectId })}
            style={styles.newTaskBtn}
          />
          <Text style={styles.sectionLabel}>Tasks</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TaskRow task={item} onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })} />
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>No tasks in this project yet</Text>}
      ListFooterComponent={
        <Button title="Delete project" variant="danger" onPress={confirmDelete} style={styles.deleteBtn} />
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.md },
  colorBar: { height: 4, borderRadius: 2, marginBottom: spacing.md, width: 48 },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900, marginBottom: 4 },
  desc: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.sm },
  taskCount: { fontSize: fontSize.xs, color: colors.gray500, marginTop: spacing.sm },
  newTaskBtn: { marginTop: spacing.md },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  taskTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.gray900 },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.lg },
  deleteBtn: { marginTop: spacing.xl, borderColor: colors.danger },
});
