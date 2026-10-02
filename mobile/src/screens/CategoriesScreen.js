import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchCategories } from '../api/categories';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function CategoryRow({ category }) {
  return (
    <View style={styles.row}>
      <View style={[styles.colorDot, { backgroundColor: category.color || colors.brand500 }]} />
      <View style={styles.rowBody}>
        <Text style={styles.name}>{category.name}</Text>
        {category.description ? <Text style={styles.desc} numberOfLines={1}>{category.description}</Text> : null}
      </View>
    </View>
  );
}

export default function CategoriesScreen({ navigation }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchCategories();
      setCategories(list);
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

  return (
    <View style={styles.flex}>
      <StatsBar stats={[{ value: categories.length, label: 'Total categories' }]} />
      <FlatList
        data={categories}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CategoryRow category={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading categories…" />
          ) : (
            <EmptyState
              icon="🏷️"
              title="No categories yet"
              subtitle="Create a category to organize your projects and tasks."
              actionLabel="Create Category"
              onAction={() => navigation.navigate('CreateCategory')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateCategory')} activeOpacity={0.85}>
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
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  rowBody: { flex: 1 },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  desc: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
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
