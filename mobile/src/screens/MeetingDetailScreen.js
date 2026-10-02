import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMeeting, toggleActionItem, completeMeeting } from '../api/meetings';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import LoadingView from '../components/LoadingView';
import { colors, spacing, radius, fontSize } from '../theme/theme';

function formatDateTime(iso) {
  if (!iso) return 'No date set';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function MeetingDetailScreen({ route }) {
  const { meetingId } = route.params;
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await getMeeting(meetingId);
      setMeeting(res.data);
    } catch {
      Alert.alert('Error', "Couldn't load this meeting.");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onToggleItem = async (itemId) => {
    setMeeting((prev) => ({
      ...prev,
      actionItems: prev.actionItems.map((a) => (a.id === itemId ? { ...a, done: !a.done } : a)),
    }));
    try {
      await toggleActionItem(meetingId, itemId);
    } catch {
      Alert.alert('Error', 'Could not update that action item.');
      load();
    }
  };

  const onComplete = () => {
    Alert.alert('Mark meeting as completed?', null, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete',
        onPress: async () => {
          try {
            await completeMeeting(meetingId);
            load();
          } catch {
            Alert.alert('Error', 'Could not complete this meeting.');
          }
        },
      },
    ]);
  };

  if (loading || !meeting) {
    return <LoadingView message="Loading meeting…" />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.headerTop}>
        <Text style={styles.title}>{meeting.title}</Text>
        <StatusBadge status={meeting.status} />
      </View>
      <Text style={styles.dateText}>{formatDateTime(meeting.meetingDate)}</Text>
      {meeting.durationMins ? <Text style={styles.dim}>{meeting.durationMins} minutes</Text> : null}

      {meeting.description ? (
        <>
          <Text style={styles.label}>Description</Text>
          <Text style={styles.bodyText}>{meeting.description}</Text>
        </>
      ) : null}

      {meeting.agenda ? (
        <>
          <Text style={styles.label}>Agenda</Text>
          <Text style={styles.bodyText}>{meeting.agenda}</Text>
        </>
      ) : null}

      {meeting.notes ? (
        <>
          <Text style={styles.label}>Notes</Text>
          <Text style={styles.bodyText}>{meeting.notes}</Text>
        </>
      ) : null}

      {meeting.attendees?.length > 0 && (
        <>
          <Text style={styles.label}>Attendees</Text>
          <View style={styles.chipRow}>
            {meeting.attendees.map((a) => (
              <View key={a} style={styles.attendeeChip}>
                <Text style={styles.attendeeChipText}>{a}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Action items</Text>
      {(meeting.actionItems || []).length === 0 ? (
        <Text style={styles.dim}>No action items yet</Text>
      ) : (
        meeting.actionItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.actionRow}
            onPress={() => onToggleItem(item.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, item.done && styles.checkboxChecked]}>
              {item.done && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.actionBody}>
              <Text style={[styles.actionTitle, item.done && styles.actionTitleDone]}>{item.title}</Text>
              {item.assignee ? <Text style={styles.actionAssignee}>{item.assignee}</Text> : null}
            </View>
          </TouchableOpacity>
        ))
      )}

      {meeting.status !== 'COMPLETED' && (
        <Button title="Mark meeting completed" variant="secondary" onPress={onComplete} style={styles.completeBtn} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900 },
  dateText: { fontSize: fontSize.sm, color: colors.gray700, marginTop: 4, fontWeight: '600' },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  bodyText: { fontSize: fontSize.sm, color: colors.gray800, lineHeight: 20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attendeeChip: { backgroundColor: colors.brand50, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  attendeeChipText: { fontSize: fontSize.xs, color: colors.brand600, fontWeight: '600' },
  actionRow: {
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
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: colors.white, fontSize: fontSize.xs, fontWeight: '800' },
  actionBody: { flex: 1 },
  actionTitle: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray900 },
  actionTitleDone: { textDecorationLine: 'line-through', color: colors.gray400 },
  actionAssignee: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
  completeBtn: { marginTop: spacing.xl },
});
