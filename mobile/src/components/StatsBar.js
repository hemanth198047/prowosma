import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize } from '../theme/theme';

// A horizontal row of compact stat tiles, meant to sit above a list —
// gives every list screen in the app the same "at a glance" summary
// treatment the Dashboard has, computed from data already loaded for
// that screen (no extra network calls anywhere this is used).
export default function StatsBar({ stats }) {
  return (
    <View style={styles.bar} accessibilityRole="summary">
      {stats.map((s, i) => (
        <View key={i} style={styles.tile} accessibilityLabel={`${s.value} ${s.label}`}>
          <Text style={[styles.value, s.color && { color: s.color }]}>{s.value}</Text>
          <Text style={styles.label}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  tile: { flex: 1, alignItems: 'center' },
  value: { fontSize: fontSize.lg, fontWeight: '800', color: colors.gray900 },
  label: { fontSize: 10, color: colors.gray500, fontWeight: '600', marginTop: 2, textAlign: 'center' },
});
