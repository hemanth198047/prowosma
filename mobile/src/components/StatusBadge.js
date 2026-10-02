import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, fontSize } from '../theme/theme';

// Matches the status values used by Task.java (TODO/IN_PROGRESS/DONE)
// and Project.java (ACTIVE/IN PROGRESS/PAUSED/DONE) — same backend, same
// vocabulary, so a status here means exactly what it means on the web app.
const STATUS_STYLES = {
  TODO: { bg: colors.gray100, fg: colors.gray700, label: 'To Do' },
  IN_PROGRESS: { bg: colors.warningBg, fg: '#B45309', label: 'In Progress' },
  'IN PROGRESS': { bg: colors.warningBg, fg: '#B45309', label: 'In Progress' },
  DONE: { bg: colors.successBg, fg: '#047857', label: 'Done' },
  ACTIVE: { bg: colors.successBg, fg: '#047857', label: 'Active' },
  PAUSED: { bg: colors.gray100, fg: colors.gray500, label: 'Paused' },
  LOW: { bg: colors.gray100, fg: colors.gray500, label: 'Low' },
  MEDIUM: { bg: colors.warningBg, fg: '#B45309', label: 'Medium' },
  HIGH: { bg: colors.dangerBg, fg: '#B91C1C', label: 'High' },
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || { bg: colors.gray100, fg: colors.gray500, label: status };
  return (
    <View
      style={[styles.badge, { backgroundColor: style.bg }]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${style.label}`}
    >
      <Text style={[styles.text, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
});
