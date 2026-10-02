import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import { colors, spacing, fontSize } from '../theme/theme';

// A real recovery path for network failures instead of a dead-end
// message — every screen that shows this should also wire onRetry to
// its own load() function so the user has one tap back to a working
// state.
export default function ErrorState({
  title = "Can't reach the server",
  subtitle = 'Check your connection and try again.',
  onRetry,
}) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {onRetry ? <Button title="Try Again" onPress={onRetry} variant="secondary" style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  icon: { fontSize: 40, marginBottom: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: '700', color: colors.gray900, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.gray500, textAlign: 'center', marginTop: 4 },
  action: { marginTop: spacing.lg, minWidth: 160 },
});
