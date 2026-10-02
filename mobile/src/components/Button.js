import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, fontSize, spacing, shadow } from '../theme/theme';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}) {
  const isSecondary = variant === 'secondary';
  const isDanger = variant === 'danger';
  const isDisabled = disabled || loading;

  const handlePress = (e) => {
    // A light tap on every button press — cheap, standard-issue polish
    // that makes the whole app feel more responsive without needing any
    // visual change. Wrapped defensively since Haptics can throw on
    // simulators/some Android configs that don't support it.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.(e);
  };

  return (
    <TouchableOpacity
      style={[
        styles.base,
        isDanger ? styles.danger : isSecondary ? styles.secondary : styles.primary,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.brand600 : colors.white} />
      ) : (
        <Text
          style={[
            styles.text,
            isDanger ? styles.textDanger : isSecondary ? styles.textSecondary : styles.textPrimary,
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: {
    backgroundColor: colors.brand500,
    ...shadow.sm,
  },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  disabled: {
    opacity: 0.6,
  },
  text: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  textPrimary: {
    color: colors.white,
  },
  textSecondary: {
    color: colors.gray800,
  },
  textDanger: {
    color: colors.danger,
  },
});
