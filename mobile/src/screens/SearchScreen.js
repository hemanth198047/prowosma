import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { fetchQuickSearch } from '../api/search';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// Screens that actually have a detail view to jump to (see
// GlobalSearchController for the full set of "type" values it can
// return: task, project, goal, doc, decision, meeting). Goals and
// Decisions don't have a dedicated detail screen in this app yet — for
// those, tapping shows an honest "not available yet" message instead of
// silently doing nothing or crashing on an unknown route name.
const ROUTE_BY_TYPE = {
  task: (id) => ({ screen: 'TaskDetail', params: { taskId: id } }),
  project: (id) => ({ screen: 'ProjectDetail', params: { projectId: id } }),
  doc: (id) => ({ screen: 'DocDetail', params: { docId: id } }),
  meeting: (id) => ({ screen: 'MeetingDetail', params: { meetingId: id } }),
};

function ResultRow({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.icon}>{item.icon || '🔎'}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {item.type}{item.subtitle ? ` · ${item.subtitle}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = async (q) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    try {
      const list = await fetchQuickSearch(q.trim());
      setResults(list);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const onChangeText = (text) => {
    setQuery(text);
    runSearch(text);
  };

  const onPressResult = (item) => {
    const routeFn = ROUTE_BY_TYPE[item.type];
    if (!routeFn) {
      Alert.alert('Not available on mobile yet', `Open ${item.type}s on the web app to view "${item.title}".`);
      return;
    }
    const { screen, params } = routeFn(item.id);
    navigation.navigate(screen, params);
  };

  return (
    <View style={styles.flex}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onChangeText}
          placeholder="Search tasks, projects, docs, meetings…"
          placeholderTextColor={colors.gray400}
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={colors.brand500} style={styles.spinner} />}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item, idx) => `${item.type}-${item.id}-${idx}`}
        renderItem={({ item }) => <ResultRow item={item} onPress={() => onPressResult(item)} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          searched && !searching ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No results for "{query}"</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    color: colors.gray900,
    backgroundColor: colors.gray50,
  },
  spinner: { marginLeft: spacing.sm },
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
  icon: { fontSize: 20 },
  rowBody: { flex: 1 },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  subtitle: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2, textTransform: 'capitalize' },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
