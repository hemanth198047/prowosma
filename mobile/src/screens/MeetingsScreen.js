import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMeetings } from '../api/meetings';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function formatDateTime(iso) {
  if (!iso) return 'No date set';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function MeetingRow({ meeting, onPress }) {
  const openItems = (meeting.actionItems || []).filter((a) => !a.done).length;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>{meeting.title}</Text>
        <StatusBadge status={meeting.status} />
      </View>
      <Text style={styles.dateText}>{formatDateTime(meeting.meetingDate)}</Text>
      {openItems > 0 && <Text style={styles.actionCount}>{openItems} open action item{openItems > 1 ? 's' : ''}</Text>}
    </TouchableOpacity>
  );
}

export default function MeetingsScreen({ navigation }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchMeetings();
      setMeetings(list);
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

  const openActionItems = meetings.reduce(
    (sum, m) => sum + (m.actionItems || []).filter((a) => !a.done).length,
    0
  );
  const upcomingCount = meetings.filter((m) => m.status !== 'COMPLETED').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: meetings.length, label: 'Total' },
          { value: upcomingCount, label: 'Upcoming', color: colors.brand600 },
          { value: openActionItems, label: 'Open actions', color: openActionItems > 0 ? colors.warning : colors.gray900 },
        ]}
      />
      <FlatList
        data={meetings}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MeetingRow meeting={item} onPress={() => navigation.navigate('MeetingDetail', { meetingId: item.id })} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading meetings…" />
          ) : (
            <EmptyState
              icon="📅"
              title="No meetings scheduled"
              subtitle="Schedule a meeting to track agendas and action items."
              actionLabel="Schedule Meeting"
              onAction={() => navigation.navigate('CreateMeeting')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateMeeting')} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: spacing.sm },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  dateText: { fontSize: fontSize.xs, color: colors.gray500 },
  actionCount: { fontSize: fontSize.xs, color: colors.warning, fontWeight: '600', marginTop: 4 },
  empty: { paddingTop: spacing.xxl, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand500,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: colors.white, fontSize: 28, fontWeight: '600', marginTop: -2 },
});
