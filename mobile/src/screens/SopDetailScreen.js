import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSop } from '../api/sops';
import StatusBadge from '../components/StatusBadge';
import LoadingView from '../components/LoadingView';
import { colors, spacing, fontSize } from '../theme/theme';

export default function SopDetailScreen({ route }) {
  const { sopId } = route.params;
  const [sop, setSop] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await getSop(sopId);
      setSop(res.data);
    } catch {
      Alert.alert('Error', "Couldn't load this SOP.");
    } finally {
      setLoading(false);
    }
  }, [sopId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading || !sop) {
    return <LoadingView message="Loading SOP…" />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.headerTop}>
        <Text style={styles.title}>{sop.title}</Text>
        <StatusBadge status={sop.status} />
      </View>
      {sop.category ? <Text style={styles.category}>{sop.category} · v{sop.version || 1}</Text> : null}

      {sop.description ? <Text style={styles.description}>{sop.description}</Text> : null}

      {sop.content ? (
        <>
          <Text style={styles.label}>Procedure</Text>
          <Text style={styles.bodyText}>{sop.content}</Text>
        </>
      ) : null}

      {(sop.steps || []).length > 0 && (
        <>
          <Text style={styles.label}>Steps</Text>
          {sop.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNumber}>{i + 1}.</Text>
              <Text style={styles.stepText}>{step.text || step.title || JSON.stringify(step)}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.xxl, fontWeight: '800', color: colors.gray900 },
  category: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 4, fontWeight: '600' },
  description: { fontSize: fontSize.sm, color: colors.gray700, marginTop: spacing.md, lineHeight: 20 },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  bodyText: { fontSize: fontSize.md, color: colors.gray800, lineHeight: 22 },
  stepRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  stepNumber: { fontSize: fontSize.sm, fontWeight: '700', color: colors.brand600, width: 20 },
  stepText: { flex: 1, fontSize: fontSize.sm, color: colors.gray800, lineHeight: 20 },
});
