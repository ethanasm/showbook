/**
 * Bottom sheet that captures seat / cost / ticket count and transitions
 * a show from `watching` → `ticketed`. The server enforces a seat on
 * that transition (`packages/api/src/routers/shows.ts` updateState), so
 * the Confirm button stays disabled until the seat field has a value.
 *
 * Mutations route through `runOptimisticMutation` + the SQLite outbox so
 * a network failure leaves a retryable `shows.updateState` row in
 * `pending_writes` instead of vanishing with a toast.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { Sheet } from './Sheet';
import { useTheme } from '../lib/theme';
import { trpc } from '../lib/trpc';
import { useFeedback } from '../lib/feedback';
import { runOptimisticMutation } from '../lib/mutations';
import { getCacheOutbox } from '../lib/cache';

export interface MarkTicketedSheetProps {
  open: boolean;
  onClose: () => void;
  showId: string;
  initialSeat?: string | null;
  initialPrice?: string | null;
  initialTicketCount?: number | null;
}

export function MarkTicketedSheet({
  open,
  onClose,
  showId,
  initialSeat,
  initialPrice,
  initialTicketCount,
}: MarkTicketedSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  const [seat, setSeat] = React.useState(initialSeat ?? '');
  const [price, setPrice] = React.useState(initialPrice ?? '');
  const [ticketCount, setTicketCount] = React.useState(
    initialTicketCount ? String(initialTicketCount) : '1',
  );
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSeat(initialSeat ?? '');
      setPrice(initialPrice ?? '');
      setTicketCount(initialTicketCount ? String(initialTicketCount) : '1');
      setSubmitting(false);
    }
  }, [open, initialSeat, initialPrice, initialTicketCount]);

  const canSubmit = seat.trim().length > 0 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    const detailKey = [['shows', 'detail'], { input: { showId }, type: 'query' }];
    const trimmedSeat = seat.trim();
    const trimmedPrice = price.trim();
    const parsedTickets = Number.parseInt(ticketCount, 10);
    const ticketCountValue =
      Number.isFinite(parsedTickets) && parsedTickets > 0 ? parsedTickets : 1;

    const payload: {
      showId: string;
      newState: 'ticketed';
      seat: string;
      pricePaid?: string;
      ticketCount: number;
    } = {
      showId,
      newState: 'ticketed' as const,
      seat: trimmedSeat,
      ticketCount: ticketCountValue,
    };
    if (trimmedPrice.length > 0) payload.pricePaid = trimmedPrice;

    try {
      await runOptimisticMutation({
        mutation: 'shows.updateState',
        input: payload,
        outbox: getCacheOutbox(),
        call: (input) => utils.client.shows.updateState.mutate(input),
        optimistic: {
          snapshot: () => queryClient.getQueryData(detailKey),
          apply: () => {
            queryClient.setQueryData(detailKey, (prev: unknown) => {
              if (!prev || typeof prev !== 'object') return prev;
              return {
                ...prev,
                state: 'ticketed',
                seat: trimmedSeat,
                pricePaid: trimmedPrice.length > 0 ? trimmedPrice : (prev as { pricePaid?: string | null }).pricePaid ?? null,
                ticketCount: ticketCountValue,
              };
            });
          },
          rollback: (snap) => queryClient.setQueryData(detailKey, snap),
        },
        reconcile: () => {
          void utils.shows.list.invalidate();
          void utils.shows.detail.invalidate({ showId });
        },
      });
      showToast({ kind: 'success', text: 'Marked as ticketed' });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      showToast({ kind: 'error', text: message });
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['58%']}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.ink }]}>I have tickets</Text>
        <Text style={[styles.hint, { color: colors.muted }]}>
          We&apos;ll move this show to the &quot;ticketed&quot; state.
        </Text>

        <Field
          label="Seat"
          value={seat}
          onChangeText={setSeat}
          placeholder="e.g. GA, Orchestra Row G Seat 12"
          autoFocus
          testID="mark-ticketed-seat-input"
        />
        <Field
          label="Total cost"
          value={price}
          onChangeText={setPrice}
          placeholder="e.g. 85.00"
          keyboardType="decimal-pad"
          testID="mark-ticketed-price-input"
        />
        <Field
          label="Tickets"
          value={ticketCount}
          onChangeText={setTicketCount}
          placeholder="1"
          keyboardType="number-pad"
          testID="mark-ticketed-count-input"
        />

        <View style={styles.actionsRow}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [
              styles.cancelBtn,
              { borderColor: colors.ruleStrong },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: colors.ink }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void submit()}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Confirm"
            testID="mark-ticketed-confirm"
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: colors.accent,
                opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.confirmLabel, { color: colors.accentText }]}>
              {submitting ? 'Saving…' : 'Confirm'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

function Field({
  label,
  testID,
  ...rest
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  testID?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.faint }]}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        {...rest}
        testID={testID}
        placeholderTextColor={colors.faint}
        style={[
          styles.input,
          {
            color: colors.ink,
            borderColor: colors.rule,
            backgroundColor: colors.surface,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  hint: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
  },
  input: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '400',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  cancelLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  confirmLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '600',
  },
});
