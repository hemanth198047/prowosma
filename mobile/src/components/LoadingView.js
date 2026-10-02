import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, fontSize } from '../theme/theme';

// Replaces plain "Loading…" text across the app with a real spinner —
// small thing, but a bare text string reads as unfinished; a spinner
// reads as an app that's actively doing something.
export default function LoadingView({ message = 'Loading…' }) {
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.brand500} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: spacing.md },
  message: { color: colors.gray500, fontSize: fontSize.sm },
});
