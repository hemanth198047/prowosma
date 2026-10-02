import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const ITEMS = [
  { label: 'Search', icon: '🔎', screen: 'Search', desc: 'Find tasks, projects, docs, meetings' },
  { label: 'Channels', icon: '💬', screen: 'Channels', desc: 'Team chat and announcements' },
  { label: 'Goals', icon: '🎯', screen: 'Goals', desc: 'Track progress toward key outcomes' },
  { label: 'Sprints', icon: '⚡', screen: 'Sprints', desc: 'Plan and track sprint cycles' },
  { label: 'Meetings', icon: '📅', screen: 'Meetings', desc: 'Agendas, notes, and action items' },
  { label: 'Docs', icon: '📄', screen: 'Docs', desc: 'Read your workspace documents' },
  { label: 'Decisions', icon: '⚖️', screen: 'Decisions', desc: 'Log and track key decisions' },
  { label: 'Change Requests', icon: '📝', screen: 'ChangeRequests', desc: 'Scope, budget, and timeline changes' },
  { label: 'KPIs', icon: '📈', screen: 'Kpis', desc: 'Track key metrics against targets' },
  { label: 'Automations', icon: '🤖', screen: 'Automations', desc: 'View and toggle automation rules' },
  { label: 'RAID Log', icon: '⚠️', screen: 'Raid', desc: 'Risks, assumptions, issues, dependencies' },
  { label: 'SOPs', icon: '📋', screen: 'Sops', desc: 'Standard operating procedures' },
  { label: 'Portfolio', icon: '💼', screen: 'Portfolio', desc: 'Programmes and strategic initiatives' },
  { label: 'Executive Overview', icon: '📊', screen: 'Executive', desc: 'Leadership rollup at a glance' },
  { label: 'Billing', icon: '💳', screen: 'Billing', desc: 'Plan, seats, and subscription' },
  { label: 'Categories', icon: '🏷️', screen: 'Categories', desc: 'Organize projects and tasks' },
  { label: 'Custom Fields', icon: '🧩', screen: 'CustomFields', desc: 'Field definitions in this workspace' },
  { label: 'Usage', icon: '📶', screen: 'AdminUsage', desc: 'Workspace stats and active users' },
  { label: 'Team', icon: '👥', screen: 'Team', desc: 'See who\u2019s in your workspace' },
  { label: 'Profile', icon: '👤', screen: 'Profile', desc: 'Your account and workspace' },
];

export default function MoreScreen({ navigation }) {
  return (
    <FlatList
      style={styles.flex}
      contentContainerStyle={styles.listContent}
      data={ITEMS}
      keyExtractor={(item) => item.screen}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate(item.screen)}
          activeOpacity={0.7}
        >
          <Text style={styles.icon}>{item.icon}</Text>
          <View style={styles.rowBody}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.desc}>{item.desc}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
  icon: { fontSize: 24 },
  rowBody: { flex: 1 },
  label: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  desc: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
  chevron: { fontSize: fontSize.xl, color: colors.gray400 },
});
