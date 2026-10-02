import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDoc } from '../api/docs';
import LoadingView from '../components/LoadingView';
import { colors, spacing, fontSize } from '../theme/theme';

// Doc content is stored as a JSON array of {id, type, content} blocks —
// confirmed against the web app's editor (frontend/src/pages/Docs.jsx):
// `content` is a plain string for every text-ish block type (it's set via
// `el.innerText = block.content`), not a nested rich-text structure. Rich
// embed types (taskembed, goalembed, database, gallery, ai, youtube,
// figma, loom, iframe, image, divider) aren't rendered here — this is a
// read-only text view, not a port of the block editor — but every text
// block renders faithfully with its real formatting.
function renderBlock(block, index) {
  const key = block.id || index;
  const text = block.content || '';

  switch (block.type) {
    case 'heading1':
      return <Text key={key} style={styles.h1}>{text}</Text>;
    case 'heading2':
      return <Text key={key} style={styles.h2}>{text}</Text>;
    case 'heading3':
      return <Text key={key} style={styles.h3}>{text}</Text>;
    case 'bulletlist':
      return (
        <View key={key} style={styles.listRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.paragraph}>{text}</Text>
        </View>
      );
    case 'numberedlist':
      return (
        <View key={key} style={styles.listRow}>
          <Text style={styles.bullet}>{(index + 1) + '.'}</Text>
          <Text style={styles.paragraph}>{text}</Text>
        </View>
      );
    case 'quote':
      return <Text key={key} style={styles.quote}>{text}</Text>;
    case 'code':
      return <Text key={key} style={styles.code}>{text}</Text>;
    case 'divider':
      return <View key={key} style={styles.divider} />;
    case 'taskembed':
    case 'goalembed':
    case 'decision':
    case 'database':
    case 'gallery':
    case 'ai':
    case 'youtube':
    case 'figma':
    case 'loom':
    case 'iframe':
    case 'image':
      return (
        <View key={key} style={styles.embedPlaceholder}>
          <Text style={styles.embedText}>📎 {block.type} embed — view on web to see this</Text>
        </View>
      );
    default:
      return text ? <Text key={key} style={styles.paragraph}>{text}</Text> : null;
  }
}

export default function DocDetailScreen({ route }) {
  const { docId } = route.params;
  const [doc, setDoc] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await getDoc(docId);
      setDoc(res.data);
      try {
        const parsed = JSON.parse(res.data.content || '[]');
        setBlocks(Array.isArray(parsed) ? parsed : []);
      } catch {
        setBlocks([]);
      }
    } catch {
      Alert.alert('Error', "Couldn't load this doc.");
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading || !doc) {
    return <LoadingView message="Loading doc…" />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.docTitle}>
        {doc.emoji || '📄'} {doc.title || 'Untitled'}
      </Text>
      {doc.category ? <Text style={styles.category}>{doc.category}</Text> : null}

      <View style={styles.body}>
        {blocks.length === 0 ? (
          <Text style={styles.dim}>This doc is empty.</Text>
        ) : (
          blocks.map(renderBlock)
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  docTitle: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.gray900 },
  category: { fontSize: fontSize.xs, color: colors.gray500, marginTop: 4, marginBottom: spacing.lg, fontWeight: '600' },
  body: { marginTop: spacing.md },
  h1: { fontSize: 24, fontWeight: '800', color: colors.gray900, marginTop: spacing.lg, marginBottom: spacing.sm },
  h2: { fontSize: 20, fontWeight: '800', color: colors.gray900, marginTop: spacing.md, marginBottom: spacing.xs },
  h3: { fontSize: 17, fontWeight: '700', color: colors.gray900, marginTop: spacing.md, marginBottom: spacing.xs },
  paragraph: { fontSize: fontSize.md, color: colors.gray800, lineHeight: 22, marginBottom: spacing.sm, flexShrink: 1 },
  listRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: 4 },
  bullet: { fontSize: fontSize.md, color: colors.gray500, width: 18 },
  quote: {
    fontSize: fontSize.md,
    color: colors.gray500,
    fontStyle: 'italic',
    borderLeftWidth: 3,
    borderLeftColor: colors.brand200,
    paddingLeft: spacing.md,
    marginBottom: spacing.sm,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: colors.gray800,
    backgroundColor: colors.gray100,
    padding: spacing.sm,
    borderRadius: 6,
    marginBottom: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  embedPlaceholder: {
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  embedText: { fontSize: fontSize.xs, color: colors.gray500 },
});
