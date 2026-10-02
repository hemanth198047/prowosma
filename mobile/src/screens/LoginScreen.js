import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { login as loginRequest, register as registerRequest, loginTwoFactor as loginTwoFactorRequest } from '../api/auth';
import Button from '../components/Button';
import { colors, spacing, radius, fontSize } from '../theme/theme';

export default function LoginScreen() {
  const { loginUser } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Two-step verification: set after the password step when the account has 2FA on.
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [code, setCode] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('Name is required');
      return;
    }
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await loginRequest({ email, password })
          : await registerRequest({ name, email, password });
      if (res.data?.requiresTwoFactor) {
        // Password accepted, but this account also needs a code: no session exists yet.
        setTwoFactorToken(res.data.twoFactorToken);
        setCode('');
        return;
      }
      await loginUser(res.data, res.data.token);
    } catch (e) {
      setError(
        e.response?.data?.message ||
          e.response?.data?.error ||
          (mode === 'login' ? 'Invalid email or password' : 'Could not create account')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactor = async () => {
    if (!code.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await loginTwoFactorRequest({ twoFactorToken, code: code.trim() });
      await loginUser(res.data, res.data.token);
    } catch (e) {
      const message = e.response?.data?.message;
      if (e.response?.status === 401 && /expired/i.test(message || '')) {
        // The five-minute window after the password step ran out: start again.
        setTwoFactorToken('');
        setCode('');
        setError(message);
      } else {
        setError(message || 'Invalid verification code');
      }
    } finally {
      setLoading(false);
    }
  };

  if (twoFactorToken) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.heading}>Two-step verification</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </Text>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Verification code</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.gray400}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="go"
              onSubmitEditing={handleTwoFactor}
              accessibilityLabel="Verification code"
            />
          </View>

          <Button
            title="Verify ->"
            onPress={handleTwoFactor}
            loading={loading}
            style={styles.submitBtn}
            accessibilityHint="Completes signing in"
          />
          <Button
            title="Back to sign in"
            variant="secondary"
            onPress={() => { setTwoFactorToken(''); setCode(''); setError(''); }}
            style={styles.submitBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>P</Text>
          </View>
          <Text style={styles.brandName}>Prowosma</Text>
        </View>

        <Text style={styles.heading}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? 'Sign in to your Prowosma workspace' : 'Start your Prowosma workspace'}
        </Text>

        <View style={styles.tabRow}>
          <Button
            title="Sign In"
            variant={mode === 'login' ? 'primary' : 'secondary'}
            onPress={() => setMode('login')}
            style={styles.tabBtn}
          />
          <Button
            title="Create account"
            variant={mode === 'register' ? 'primary' : 'secondary'}
            onPress={() => setMode('register')}
            style={styles.tabBtn}
          />
        </View>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        {mode === 'register' && (
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.gray400}
              autoCapitalize="words"
              returnKeyType="next"
              accessibilityLabel="Name"
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Email address</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            placeholderTextColor={colors.gray400}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            accessibilityLabel="Email address"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.gray400}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            accessibilityLabel="Password"
          />
        </View>

        <Button
          title={mode === 'login' ? 'Sign in →' : 'Create account →'}
          onPress={handleSubmit}
          loading={loading}
          style={styles.submitBtn}
          accessibilityHint={mode === 'login' ? 'Signs you into your workspace' : 'Creates a new account and workspace'}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.brand500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { color: colors.white, fontWeight: '800', fontSize: fontSize.lg },
  brandName: { fontSize: fontSize.lg, fontWeight: '800', color: colors.gray900 },
  heading: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.gray900, marginBottom: 4 },
  subtitle: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.xl },
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  tabBtn: { flex: 1 },
  field: { marginBottom: spacing.lg },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray700, marginBottom: 6 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    color: colors.gray900,
    backgroundColor: colors.gray50,
  },
  error: {
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    fontSize: fontSize.sm,
  },
  submitBtn: { marginTop: spacing.sm },
});
