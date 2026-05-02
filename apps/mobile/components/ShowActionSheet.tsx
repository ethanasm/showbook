/**
 * Action sheet shown via long-press on a ShowCard or the more-menu on
 * ShowDetail. Lives outside `app/show/[id].tsx` so list screens (Home,
 * Shows, Artist, Venue) can mount it on long-press without pulling in
 * the detail screen.
 *
 * Mutations route through `runOptimisticMutation` + the shared SQLite
 * outbox so a network failure leaves a retryable row in
 * `pending_writes` instead of vanishing with a toast. Delete is
 * confirmed via `Alert.alert` because it's irreversible — the prior
 * "tap again to confirm" pattern is too easy to fat-finger and
 * vulnerable to a tap-jacking overlay timing attack.
 */

import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  ListMusic,
  Pencil,
  Trash2,
} from 'lucide-react-native';

import { Sheet } from './Sheet';
import { useTheme, type ShowState } from '../lib/theme';
import { trpc } from '../lib/trpc';
import { useFeedback } from '../lib/feedback';
import { runOptimisticMutation } from '../lib/mutations';
import { getCacheOutbox } from '../lib/cache';

export interface ShowActionSheetProps {
  open: boolean;
  onClose: () => void;
  showId: string;
  state: ShowState;
  /** When true, popping the show after delete returns to /(tabs)/shows. */
  popAfterDelete?: boolean;
}

export function ShowActionSheet({
  open,
  onClose,
  showId,
  state,
  popAfterDelete = false,
}: ShowActionSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  const goEdit = () => {
    onClose();
    router.push(`/show/${showId}/edit`);
  };
  const goSetlist = () => {
    onClose();
    router.push(`/show/${showId}/setlist`);
  };

  const markWatched = async (): Promise<void> => {
    if (state === 'past') {
      showToast({ kind: 'info', text: 'Already marked as watched' });
      onClose();
      return;
    }
    const detailKey = [['shows', 'detail'], { input: { showId }, type: 'query' }];
    try {
      await runOptimisticMutation({
        mutation: 'shows.updateState',
        input: { showId, newState: 'past' as const },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.shows.updateState.mutate(input),
        optimistic: {
          snapshot: () => queryClient.getQueryData(detailKey),
          apply: () => {
            queryClient.setQueryData(detailKey, (prev: unknown) => {
              if (!prev || typeof prev !== 'object') return prev;
              return { ...prev, state: 'past' };
            });
          },
          rollback: (snap) => queryClient.setQueryData(detailKey, snap),
        },
        reconcile: () => {
          void utils.shows.list.invalidate();
          void utils.shows.detail.invalidate({ showId });
        },
      });
      showToast({ kind: 'success', text: 'Marked as watched' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      showToast({ kind: 'error', text: message });
    } finally {
      onClose();
    }
  };

  const performDelete = async (): Promise<void> => {
    try {
      await runOptimisticMutation({
        mutation: 'shows.delete',
        input: { showId },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.shows.delete.mutate(input),
        reconcile: () => {
          void utils.shows.list.invalidate();
        },
      });
      showToast({ kind: 'success', text: 'Show deleted' });
      onClose();
      if (popAfterDelete) router.replace('/(tabs)/shows');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      showToast({ kind: 'error', text: message });
    }
  };

  const askDelete = () => {
    Alert.alert(
      'Delete show?',
      'This removes the show, its setlists, and any tagged media. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['44%']}>
      <View style={styles.body}>
        <ActionRow
          icon={<Pencil size={18} color={colors.ink} strokeWidth={2} />}
          label="Edit show"
          onPress={goEdit}
        />
        <ActionRow
          icon={<ListMusic size={18} color={colors.ink} strokeWidth={2} />}
          label="Edit setlist"
          onPress={goSetlist}
        />
        <ActionRow
          icon={<CheckCircle size={18} color={colors.ink} strokeWidth={2} />}
          label="Mark as watched"
          onPress={() => void markWatched()}
          disabled={state === 'past'}
        />
        <ActionRow
          icon={<Trash2 size={18} color={colors.danger} strokeWidth={2} />}
          label="Delete show"
          onPress={askDelete}
          danger
        />
      </View>
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.rule, opacity: disabled ? 0.4 : 1 },
        pressed && { backgroundColor: colors.surface },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text
        style={[
          styles.label,
          { color: danger ? colors.danger : colors.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '500',
  },
});
