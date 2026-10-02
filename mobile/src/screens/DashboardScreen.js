import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getDashboardSummary } from '../api/dashboard';
import { fetchProjects } from '../api/projects';
import { fetchGoals } from '../api/goals';
import { fetchKpis } from '../api/kpis';
import { fetchMeetings } from '../api/meetings';
import { fetchAutomations } from '../api/automations';
import { fetchTeamMembers } from '../api/team';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// This is deliberately a much richer view than a typical "4 numbers on a
// screen" mobile dashboard — it mirrors the web app's own Dashboard,
// which surfaces Work Hub / Insights Hub tile grids alongside live data
// previews, precisely so the mobile app doesn't read as a stripped-down
// afterthought next to the full product. Every section here pulls real
// data from endpoints already built elsewhere in this app; nothing is
// placeholder.

function StatTile({ label, value, color }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, { color: color || colors.gray900 }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, onPress }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onPress && (
        <TouchableOpacity onPress={onPress}>
          <Text style={styles.sectionLink}>View all →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ProjectPreviewRow({ project }) {
  return (
    <View style={styles.previewRow}>
      <View style={[styles.colorDot, { backgroundColor: project.color || colors.brand500 }]} />
      <Text style={styles.previewTitle} numberOfLines={1}>{project.name}</Text>
      <StatusBadge status={project.status} />
    </View>
  );
}

function GoalPreviewRow({ goal }) {
  return (
    <View style={styles.previewRowStacked}>
      <Text style={styles.previewTitle} numberOfLines={1}>{goal.title}</Text>
      <View style={styles.miniProgressTrack}>
        <View style={[styles.miniProgressFill, { width: `${goal.progress || 0}%` }]} />
      </View>
    </View>
  );
}

function MeetingPreviewRow({ meeting }) {
  const dateStr = meeting.meetingDate
    ? new Date(meeting.meetingDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'No date';
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewIcon}>📅</Text>
      <Text style={styles.previewTitle} numberOfLines={1}>{meeting.title}</Text>
      <Text style={styles.previewMeta}>{dateStr}</Text>
    </View>
  );
}

// The "Quick Access" grid — this is the single biggest lever for making
// the app feel feature-complete at a glance, mirroring the web app's own
// icon-tile Work Hub/Insights Hub sections. Navigates across tabs into
// nested stacks (React Navigation supports this from any screen inside
// the same Tab.Navigator).
function QuickAccessGrid({ navigation }) {
  const items = [
    { label: 'Kanban', icon: '📋', nav: () => navigation.navigate('Kanban') },
    { label: 'Sprints', icon: '⚡', nav: () => navigation.navigate('More', { screen: 'Sprints' }) },
    { label: 'Goals', icon: '🎯', nav: () => navigation.navigate('More', { screen: 'Goals' }) },
    { label: 'Meetings', icon: '📅', nav: () => navigation.navigate('More', { screen: 'Meetings' }) },
    { label: 'Docs', icon: '📄', nav: () => navigation.navigate('More', { screen: 'Docs' }) },
    { label: 'Channels', icon: '💬', nav: () => navigation.navigate('More', { screen: 'Channels' }) },
    { label: 'Decisions', icon: '⚖️', nav: () => navigation.navigate('More', { screen: 'Decisions' }) },
    { label: 'Changes', icon: '📝', nav: () => navigation.navigate('More', { screen: 'ChangeRequests' }) },
    { label: 'RAID Log', icon: '⚠️', nav: () => navigation.navigate('More', { screen: 'Raid' }) },
    { label: 'SOPs', icon: '📋', nav: () => navigation.navigate('More', { screen: 'Sops' }) },
    { label: 'Portfolio', icon: '💼', nav: () => navigation.navigate('More', { screen: 'Portfolio' }) },
    { label: 'Search', icon: '🔎', nav: () => navigation.navigate('More', { screen: 'Search' }) },
  ];
  return (
    <View style={styles.quickGrid}>
      {items.map((item) => (
        <TouchableOpacity key={item.label} style={styles.quickTile} onPress={item.nav} activeOpacity={0.7}>
          <Text style={styles.quickIcon}>{item.icon}</Text>
          <Text style={styles.quickLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function DashboardScreen({ navigation }) {
  const { user, activeWorkspace } = useAuth();
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [goals, setGoals] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [automationCount, setAutomationCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    setErrored(false);
    try {
      const [summaryRes, projectList, goalList, kpiList, meetingList, automationList, teamList] =
        await Promise.all([
          getDashboardSummary(),
          fetchProjects().catch(() => []),
          fetchGoals().catch(() => []),
          fetchKpis().catch(() => []),
          fetchMeetings().catch(() => []),
          fetchAutomations().catch(() => []),
          fetchTeamMembers().catch(() => []),
        ]);
      setSummary(summaryRes.data);
      setProjects(projectList);
      setGoals(goalList);
      setKpis(kpiList);
      setMeetings(meetingList);
      setAutomationCount(automationList.filter((a) => a.enabled).length);
      setTeamCount(teamList.length);
    } catch {
      setErrored(true);
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.dim}>Loading your command center…</Text>
      </View>
    );
  }

  if (errored || !summary) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Can't reach the server</Text>
        <Text style={styles.dim}>Pull down to try again.</Text>
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />
      </View>
    );
  }

  const activeProjects = projects.filter((p) => p.status === 'ACTIVE').slice(0, 3);
  const topGoals = goals.slice(0, 3);
  const upcomingMeetings = meetings.filter((m) => m.status !== 'COMPLETED').slice(0, 3);
  const kpiAlerts = kpis.filter((k) => k.alertTriggered).length;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] || 'there'} 👋</Text>
      <Text style={styles.workspaceName}>{activeWorkspace?.name}</Text>

      {summary.overdueCount > 0 && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertText}>
            ⚠ {summary.overdueCount} overdue item{summary.overdueCount > 1 ? 's' : ''} need attention
          </Text>
        </View>
      )}

      <Card style={styles.statsCard}>
        <View style={styles.statsRow}>
          <StatTile label="Total tasks" value={summary.totalTasks ?? 0} />
          <StatTile label="Done" value={summary.doneTasks ?? 0} color={colors.success} />
          <StatTile label="In progress" value={summary.inProgressTasks ?? 0} color={colors.warning} />
        </View>
        <View style={styles.statsRow}>
          <StatTile label="Projects" value={projects.length} color={colors.brand600} />
          <StatTile label="Goals" value={goals.length} />
          <StatTile label="Team" value={teamCount} />
        </View>
      </Card>

      <Text style={styles.gridHeading}>Quick Access</Text>
      <QuickAccessGrid navigation={navigation} />

      <Card style={styles.section}>
        <SectionHeader title="Active Projects" onPress={() => navigation.navigate('Projects')} />
        {activeProjects.length === 0 ? (
          <Text style={styles.dim}>No active projects</Text>
        ) : (
          activeProjects.map((p) => <ProjectPreviewRow key={p.id} project={p} />)
        )}
      </Card>

      <Card style={styles.section}>
        <SectionHeader title="Goals" onPress={() => navigation.navigate('More', { screen: 'Goals' })} />
        {topGoals.length === 0 ? (
          <Text style={styles.dim}>No goals set yet</Text>
        ) : (
          topGoals.map((g) => <GoalPreviewRow key={g.id} goal={g} />)
        )}
      </Card>

      <Card style={styles.section}>
        <SectionHeader title="Upcoming Meetings" onPress={() => navigation.navigate('More', { screen: 'Meetings' })} />
        {upcomingMeetings.length === 0 ? (
          <Text style={styles.dim}>Nothing scheduled</Text>
        ) : (
          upcomingMeetings.map((m) => <MeetingPreviewRow key={m.id} meeting={m} />)
        )}
      </Card>

      <View style={styles.miniStatsRow}>
        <TouchableOpacity style={styles.miniStatCard} onPress={() => navigation.navigate('More', { screen: 'Kpis' })}>
          <Text style={styles.miniStatValue}>{kpis.length}</Text>
          <Text style={styles.miniStatLabel}>KPIs tracked</Text>
          {kpiAlerts > 0 && <Text style={styles.miniStatAlert}>{kpiAlerts} below target</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.miniStatCard}
          onPress={() => navigation.navigate('More', { screen: 'Automations' })}
        >
          <Text style={styles.miniStatValue}>{automationCount}</Text>
          <Text style={styles.miniStatLabel}>Automations active</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  errorTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.gray900, marginBottom: 6 },
  greeting: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.gray900 },
  workspaceName: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.md },
  alertBanner: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  alertText: { color: '#B91C1C', fontWeight: '700', fontSize: fontSize.sm },
  statsCard: { marginBottom: spacing.lg },
  statsRow: { flexDirection: 'row', marginBottom: spacing.sm },
  statTile: { flex: 1 },
  statValue: { fontSize: fontSize.xl, fontWeight: '800' },
  statLabel: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600', marginTop: 2 },

  gridHeading: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg, marginHorizontal: -spacing.xs },
  quickTile: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  quickIcon: { fontSize: 26, marginBottom: 4 },
  quickLabel: { fontSize: 10, color: colors.gray700, fontWeight: '600', textAlign: 'center' },

  section: { marginBottom: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionLink: { fontSize: fontSize.xs, color: colors.brand600, fontWeight: '700' },

  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  previewRowStacked: { paddingVertical: 6 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  previewIcon: { fontSize: fontSize.sm },
  previewTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.gray900 },
  previewMeta: { fontSize: fontSize.xs, color: colors.gray400, fontWeight: '600' },
  miniProgressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.gray100, overflow: 'hidden', marginTop: 4 },
  miniProgressFill: { height: 4, borderRadius: 2, backgroundColor: colors.brand500 },

  miniStatsRow: { flexDirection: 'row', gap: spacing.sm },
  miniStatCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  miniStatValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900 },
  miniStatLabel: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600', marginTop: 2 },
  miniStatAlert: { fontSize: 10, color: colors.danger, fontWeight: '700', marginTop: 4 },
});
