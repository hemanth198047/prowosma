import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchDocs } from '../api/docs';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function DocRow({ doc, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.emoji}>{doc.emoji || '📄'}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.title} numberOfLines={1}>{doc.title || 'Untitled'}</Text>
        {doc.category ? <Text style={styles.category}>{doc.category}</Text> : null}
      </View>
      {doc.favorite && <Text style={styles.star}>★</Text>}
    </TouchableOpacity>
  );
}

export default function DocsScreen({ navigation }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchDocs();
      setDocs(list.filter((d) => !d.deleted));
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

  const categoryCount = new Set(docs.map((d) => d.category).filter(Boolean)).size;
  const favoriteCount = docs.filter((d) => d.favorite).length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: docs.length, label: 'Total' },
          { value: categoryCount, label: 'Categories' },
          { value: favoriteCount, label: 'Favorites', color: colors.warning },
        ]}
      />
      <FlatList
        style={styles.flex}
        data={docs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <DocRow doc={item} onPress={() => navigation.navigate('DocDetail', { docId: item.id })} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading docs…" />
          ) : (
            <EmptyState icon="📄" title="No docs yet" subtitle="Docs created on the web app will show up here." />
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
  emoji: { fontSize: 22 },
  rowBody: { flex: 1 },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  category: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
  star: { color: colors.warning, fontSize: fontSize.lg },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
