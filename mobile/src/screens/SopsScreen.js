import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchSops } from '../api/sops';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function SopRow({ sop, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowTop}>
        <Text style={styles.title} numberOfLines={1}>{sop.title}</Text>
        <StatusBadge status={sop.status} />
      </View>
      {sop.category ? <Text style={styles.category}>{sop.category}</Text> : null}
    </TouchableOpacity>
  );
}

export default function SopsScreen({ navigation }) {
  const [sops, setSops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchSops();
      setSops(list);
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

  const publishedCount = sops.filter((s) => s.status === 'PUBLISHED').length;
  const draftCount = sops.filter((s) => s.status === 'DRAFT').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: sops.length, label: 'Total' },
          { value: publishedCount, label: 'Published', color: colors.success },
          { value: draftCount, label: 'Draft' },
        ]}
      />
      <FlatList
        style={styles.flex}
        data={sops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SopRow sop={item} onPress={() => navigation.navigate('SopDetail', { sopId: item.id })} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading SOPs…" />
          ) : (
            <EmptyState
              icon="📋"
              title="No SOPs published yet"
              subtitle="Standard operating procedures published on the web app will show up here."
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
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  category: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 4 },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
