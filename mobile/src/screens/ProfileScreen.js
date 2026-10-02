import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import { colors, spacing, fontSize } from '../theme/theme';

export default function ProfileScreen() {
  const { user, activeWorkspace, logoutUser } = useAuth();

  // A confirmation step here matters more than it looks — this is a
  // single tap with no undo, and it's sitting at the bottom of a menu a
  // thumb can brush past accidentally while scrolling.
  const confirmLogout = () => {
    Alert.alert('Log out?', `You'll need to sign in again to access ${activeWorkspace?.name || 'your workspace'}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logoutUser },
    ]);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <View style={styles.avatar} accessibilityLabel={`Avatar for ${user?.name || 'user'}`}>
          <Text style={styles.avatarText}>{(user?.name || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user?.role}</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Workspace</Text>
        <Text style={styles.workspaceName}>{activeWorkspace?.name || 'None selected'}</Text>
      </Card>

      <Button
        title="Log out"
        variant="danger"
        onPress={confirmLogout}
        style={styles.logoutBtn}
        accessibilityHint="Signs you out of Prowosma on this device"
      />

      <Text style={styles.footer}>Prowosma Mobile v1.0.0</Text>
      <Text style={styles.footerDim}>{API_BASE_URL.replace('/api', '')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: { alignItems: 'center', marginBottom: spacing.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brand500,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { color: colors.white, fontSize: fontSize.xxl, fontWeight: '800' },
  name: { fontSize: fontSize.lg, fontWeight: '700', color: colors.gray900 },
  email: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  role: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.brand600,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
  },
  workspaceName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray900, marginTop: 4 },
  logoutBtn: { marginTop: spacing.md },
  footer: { textAlign: 'center', color: colors.gray400, fontSize: fontSize.xs, marginTop: spacing.xl },
  footerDim: { textAlign: 'center', color: colors.gray300, fontSize: 10, marginTop: 2 },
});
