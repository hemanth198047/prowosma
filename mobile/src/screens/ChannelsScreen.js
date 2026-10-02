import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchChannels } from '../api/channels';
import StatsBar from '../components/StatsBar';
import LoadingView from '../components/LoadingView';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radius, fontSize } from '../theme/theme';

const TYPE_ICON = { PROJECT: '📁', TEAM: '👥', DM: '💬', ANNOUNCEMENT: '📢' };

function ChannelRow({ channel, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.icon}>{TYPE_ICON[channel.type] || '#'}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.name}>{channel.name}</Text>
        {channel.description ? (
          <Text style={styles.desc} numberOfLines={1}>{channel.description}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function ChannelsScreen({ navigation }) {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchChannels();
      setChannels(list.filter((c) => !c.archived));
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

  const teamCount = channels.filter((c) => c.type === 'TEAM').length;
  const projectCount = channels.filter((c) => c.type === 'PROJECT').length;

  return (
    <View style={styles.flex}>
      <StatsBar
        stats={[
          { value: channels.length, label: 'Total' },
          { value: teamCount, label: 'Team' },
          { value: projectCount, label: 'Project' },
        ]}
      />
      <FlatList
        data={channels}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ChannelRow
            channel={item}
            onPress={() => navigation.navigate('ChannelDetail', { channelId: item.id, channelName: item.name })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <LoadingView message="Loading channels…" />
          ) : (
            <EmptyState
              icon="💬"
              title="No channels yet"
              subtitle="Create a channel to start chatting with your team."
              actionLabel="Create Channel"
              onAction={() => navigation.navigate('CreateChannel')}
            />
          )
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('CreateChannel')} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
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
  icon: { fontSize: 22 },
  rowBody: { flex: 1 },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  desc: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 2 },
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
