import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchCustomFields } from '../api/customFields';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const TYPE_ICON = { TEXT: '✏️', NUMBER: '#️⃣', DATE: '📅', DROPDOWN: '📋', CHECKBOX: '☑️' };

// Read-only — same reasoning as Automations: conditional show/hide/require
// logic (CustomField.java's `conditions` list) is a small rule-builder
// problem in its own right. Seeing what fields exist on which entity
// types covers the useful "what am I supposed to fill in" mobile use
// case without that build.
function FieldRow({ field }) {
  return (
    <View style={styles.row}>
      <Text style={styles.icon}>{TYPE_ICON[field.type] || '❔'}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.name}>
          {field.name}
          {field.required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        <Text style={styles.meta}>
          {field.type} · on {field.entityType?.toLowerCase()}s
        </Text>
        {field.options?.length > 0 && (
          <Text style={styles.options} numberOfLines={1}>{field.options.join(', ')}</Text>
        )}
      </View>
    </View>
  );
}

export default function CustomFieldsScreen() {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchCustomFields();
      setFields(list);
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

  const taskFields = fields.filter((f) => f.entityType === 'TASK').length;
  const projectFields = fields.filter((f) => f.entityType === 'PROJECT').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: fields.length, label: 'Total' },
          { value: taskFields, label: 'On tasks' },
          { value: projectFields, label: 'On projects' },
        ]}
      />
      <FlatList
        style={styles.flex}
        data={fields}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FieldRow field={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading custom fields…" />
          ) : (
            <EmptyState
              icon="🧩"
              title="No custom fields defined yet"
              subtitle="Custom fields created on the web app will show up here."
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
    alignItems: 'flex-start',
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
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  required: { color: colors.danger },
  meta: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2, textTransform: 'capitalize' },
  options: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 4 },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
