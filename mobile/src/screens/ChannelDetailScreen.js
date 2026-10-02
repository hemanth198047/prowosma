import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { fetchChannelMessages, postChannelMessage } from '../api/channels';
import { colors, spacing, radius, fontSize } from '../theme/theme';

// No native WebSocket client wired up here on purpose — the web app's
// real-time updates go through the STOMP/SockJS connection set up in
// useWebSocket.js, and porting that to React Native needs
// react-native-sockjs or a raw WebSocket reimplementation of the STOMP
// protocol, either of which is a meaningfully bigger, riskier lift to
// verify without a physical device than a plain polling refresh. This
// polls every 4 seconds while the screen is focused, which is a
// reasonable "feels live enough" middle ground for a first version —
// swapping in the real socket later is a contained change scoped to this
// one screen's data-fetching, not a redesign.
const POLL_INTERVAL_MS = 4000;

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function MessageBubble({ message, isMine }) {
  return (
    <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, isMine && styles.bubbleMine]}>
        {!isMine && <Text style={styles.authorName}>{message.authorName || message.authorEmail}</Text>}
        <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{message.content}</Text>
        <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>{formatTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

export default function ChannelDetailScreen({ route }) {
  const { channelId } = route.params;
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchChannelMessages(channelId, { size: 100 });
      setMessages(list);
    } catch {
      // silent on poll failures — don't spam alerts every 4 seconds
    }
  }, [channelId]);

  useFocusEffect(
    useCallback(() => {
      load();
      pollRef.current = setInterval(load, POLL_INTERVAL_MS);
      return () => clearInterval(pollRef.current);
    }, [load])
  );

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    setSending(true);
    try {
      await postChannelMessage(channelId, { content });
      load();
    } catch {
      Alert.alert('Error', 'Could not send that message.');
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble message={item} isMine={item.authorEmail === user?.email} />
        )}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No messages yet — say hello 👋</Text>
          </View>
        }
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor={colors.gray400}
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={sending || !draft.trim()}>
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
  emptyText: { color: colors.gray400, fontSize: fontSize.sm },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  bubbleMine: { backgroundColor: colors.brand500, borderColor: colors.brand500 },
  authorName: { fontSize: fontSize.xs, fontWeight: '700', color: colors.brand600, marginBottom: 2 },
  bubbleText: { fontSize: fontSize.sm, color: colors.gray900 },
  bubbleTextMine: { color: colors.white },
  bubbleTime: { fontSize: 10, color: colors.gray400, marginTop: 4, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.7)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.gray900,
    backgroundColor: colors.gray50,
  },
  sendBtn: {
    backgroundColor: colors.brand500,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  sendBtnText: { color: colors.white, fontWeight: '700', fontSize: fontSize.sm },
});
