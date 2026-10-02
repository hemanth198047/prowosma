import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import { colors, spacing, fontSize } from '../theme/theme';

// A consistent "nothing here yet" treatment across every list screen —
// icon + message + an optional one-tap way to fix it, instead of every
// screen having its own bare gray text. The action is what actually
// matters for usability: an empty list with no way forward is a dead
// end, not a design choice.
export default function EmptyState({ icon = '📭', title, subtitle, actionLabel, onAction }) {
  return (
    <View style={styles.container} accessibilityRole="text">
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  icon: { fontSize: 40, marginBottom: spacing.sm },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray700, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.gray500, textAlign: 'center', marginTop: 4 },
  action: { marginTop: spacing.lg, minWidth: 180 },
});
