import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchTeamMembers } from '../api/team';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const ROLE_COLORS = {
  OWNER: '#f59e0b',
  ADMIN: '#ef4444',
  MEMBER: colors.brand500,
  VIEWER: colors.success,
};

function MemberRow({ member }) {
  const roleColor = ROLE_COLORS[member.role] || colors.gray400;
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: member.color || colors.brand500 }]}>
        <Text style={styles.avatarText}>{(member.name || '?').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.name}>{member.name}</Text>
        <Text style={styles.email}>{member.email}</Text>
      </View>
      <View style={[styles.roleBadge, { backgroundColor: roleColor + '22' }]}>
        <Text style={[styles.roleText, { color: roleColor }]}>{member.role}</Text>
      </View>
    </View>
  );
}

export default function TeamScreen() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchTeamMembers();
      setMembers(list);
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

  const adminCount = members.filter((m) => m.role === 'ADMIN' || m.role === 'OWNER').length;
  const memberCount = members.filter((m) => m.role === 'MEMBER').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: members.length, label: 'Total' },
          { value: adminCount, label: 'Admins/Owner', color: colors.brand600 },
          { value: memberCount, label: 'Members' },
        ]}
      />
      <FlatList
        style={styles.flex}
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MemberRow member={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading team…" />
          ) : (
            <EmptyState icon="👥" title="No team members yet" subtitle="Invite teammates from the web app to see them here." />
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
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontWeight: '800', fontSize: fontSize.md },
  rowBody: { flex: 1 },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  email: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  roleText: { fontSize: fontSize.xs, fontWeight: '700' },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
});
