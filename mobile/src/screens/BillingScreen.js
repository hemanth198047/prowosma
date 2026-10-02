import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Linking, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getBillingSummary, startTrial, openBillingPortal } from '../api/billing';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingView from '../components/LoadingView';
import { colors, spacing, fontSize } from '../theme/theme';

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BillingScreen() {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getBillingSummary();
      setBilling(res.data);
    } catch {
      // keep existing data on transient error
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

  const handleStartTrial = async () => {
    setBusy(true);
    try {
      await startTrial();
      load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not start the trial.');
    } finally {
      setBusy(false);
    }
  };

  // Stripe Checkout/Billing Portal are hosted web pages — this app opens
  // them in the device's browser rather than trying to embed a webview,
  // same as how a payment flow should behave on mobile generally.
  const handleManageBilling = async () => {
    setBusy(true);
    try {
      const res = await openBillingPortal();
      if (res.data?.url) {
        Linking.openURL(res.data.url);
      }
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not open the billing portal.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !billing) {
    return <LoadingView message="Loading billing info…" />;
  }

  const seatsPct = billing.seatLimit > 0 ? Math.min(100, (billing.seatsUsed / billing.seatLimit) * 100) : 0;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Card style={styles.card}>
        <Text style={styles.planName}>{billing.planName}</Text>
        <Text style={styles.status}>{billing.status}</Text>

        {billing.trialEnd && !billing.trialUsed ? (
          <Text style={styles.trialText}>Trial ends {formatDate(billing.trialEnd)}</Text>
        ) : null}
        {billing.cancelAtPeriodEnd ? (
          <Text style={styles.cancelText}>Cancels on {formatDate(billing.currentPeriodEnd)}</Text>
        ) : billing.currentPeriodEnd ? (
          <Text style={styles.dim}>Renews {formatDate(billing.currentPeriodEnd)}</Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Seats</Text>
        <Text style={styles.seatsText}>
          {billing.seatsUsed} / {billing.seatLimit} used
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${seatsPct}%` }]} />
        </View>
        {billing.pendingInvites > 0 ? (
          <Text style={styles.dim}>{billing.pendingInvites} pending invite{billing.pendingInvites > 1 ? 's' : ''}</Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Features</Text>
        {Object.entries(billing.features || {}).map(([key, enabled]) => (
          <View key={key} style={styles.featureRow}>
            <Text style={styles.featureName}>{key.replace(/([A-Z])/g, ' $1').trim()}</Text>
            <Text style={enabled ? styles.featureOn : styles.featureOff}>{enabled ? '✓' : '—'}</Text>
          </View>
        ))}
      </Card>

      {!billing.trialUsed && !billing.hasPaymentMethod && (
        <Button title="Start 14-Day Pro Trial" onPress={handleStartTrial} loading={busy} style={styles.actionBtn} />
      )}
      <Button
        title="Manage Billing"
        variant="secondary"
        onPress={handleManageBilling}
        loading={busy}
        style={styles.actionBtn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.gray500, fontSize: fontSize.sm },
  card: { marginBottom: spacing.md, alignItems: 'flex-start' },
  planName: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900 },
  status: { fontSize: fontSize.xs, fontWeight: '700', color: colors.brand600, textTransform: 'uppercase', marginTop: 2 },
  trialText: { fontSize: fontSize.sm, color: colors.warning, fontWeight: '600', marginTop: spacing.sm },
  cancelText: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600', marginTop: spacing.sm },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.gray500,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  seatsText: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900, marginBottom: spacing.xs },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.gray100, overflow: 'hidden', width: '100%', marginBottom: spacing.xs },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand500 },
  featureRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 4 },
  featureName: { fontSize: fontSize.sm, color: colors.gray700, textTransform: 'capitalize' },
  featureOn: { fontSize: fontSize.sm, color: colors.success, fontWeight: '800' },
  featureOff: { fontSize: fontSize.sm, color: colors.gray300 },
  actionBtn: { marginTop: spacing.sm },
});
