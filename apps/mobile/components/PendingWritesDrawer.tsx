/**
 * PendingWritesDrawer — bottom sheet listing the offline outbox.
 *
 * Read-only consumer of `lib/cache/outbox.ts`. Each row shows the mutation
 * label + a relative timestamp + the last error (if any). The Retry
 * button kicks the parent-supplied `onRetry` (which calls into
 * `replayOutboxOnce`); Discard drops the row from the outbox.
 *
 * The drawer doesn't subscribe to anything — `entries` is passed in from
 * the parent, which is the bridge that owns the polling cadence + the
 * outbox singleton. Keeping the component dumb means it composes with
 * any state source without re-reading the disk.
 */

import React from 'react';
import { Alert, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Inbox, RefreshCw, Trash2 } from 'lucide-react-native';

import { Sheet } from './Sheet';
import { EmptyState } from './EmptyState';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';
import type { PendingWrite, PendingMutation } from '../lib/network';

export interface PendingWritesDrawerProps {
  open: boolean;
  onClose: () => void;
  entries: PendingWrite[];
  onRetry: () => void;
  onDiscard: (id: string) => void;
  /** Disable the global Retry CTA when offline. */
  online: boolean;
  /** True while a replay pass is in flight — disables Retry. */
  syncing?: boolean;
}

const MUTATION_LABEL: Record<PendingMutation, string> = {
  'shows.create': 'Create show',
  'shows.update': 'Edit show',
  'shows.delete': 'Delete show',
  'shows.updateState': 'Change show state',
  'shows.setSetlist': 'Update setlist',
};

export function PendingWritesDrawer({
  open,
  onClose,
  entries,
  onRetry,
  onDiscard,
  online,
  syncing,
}: PendingWritesDrawerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const headerSubtitle =
    entries.length === 0
      ? 'No pending changes'
      : `${entries.length} pending change${entries.length === 1 ? '' : 's'}`;

  const retryDisabled = !online || syncing || entries.length === 0;

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['60%', '85%']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.ink }]}>Pending changes</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{headerSubtitle}</Text>
        </View>
        <Pressable
          onPress={onRetry}
          disabled={retryDisabled}
          accessibilityRole="button"
          accessibilityLabel="Retry pending changes"
          style={({ pressed }) => [
            styles.retryAll,
            { backgroundColor: colors.accent },
            (retryDisabled || pressed) && styles.pressed,
            retryDisabled && { opacity: 0.4 },
          ]}
        >
          <RefreshCw size={14} color={colors.accentText} strokeWidth={2} />
          <Text style={[styles.retryAllLabel, { color: colors.accentText }]}>
            {syncing ? 'Syncing…' : 'Retry all'}
          </Text>
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={<Inbox size={40} color={colors.muted} />}
            title="Nothing to sync"
            subtitle="Edits made while offline will appear here."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {entries.map((entry) => (
            <PendingRow
              key={entry.id}
              entry={entry}
              onDiscard={() => confirmDiscard(entry, onDiscard)}
            />
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

function confirmDiscard(
  entry: PendingWrite,
  onDiscard: (id: string) => void,
): void {
  // Discarding loses the user's offline work permanently. The Alert
  // handles the same family of risks the Delete-show flow does (a
  // mistap on a small target shouldn't drop user data).
  const label = MUTATION_LABEL[entry.mutation] ?? entry.mutation;
  Alert.alert(
    'Discard pending change?',
    `This permanently drops "${label}". The change won't be saved when you reconnect.`,
    [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => onDiscard(entry.id),
      },
    ],
  );
}

function PendingRow({
  entry,
  onDiscard,
}: {
  entry: PendingWrite;
  onDiscard: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const label = MUTATION_LABEL[entry.mutation] ?? entry.mutation;
  const when = formatRelative(new Date(entry.createdAt));
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.rule },
      ]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.ink }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
          Queued {when}
          {entry.attempts > 0 ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}` : ''}
        </Text>
        {entry.lastError ? (
          <Text
            style={[styles.rowError, { color: colors.danger }]}
            numberOfLines={2}
          >
            {entry.lastError}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onDiscard}
        accessibilityRole="button"
        accessibilityLabel="Discard pending change"
        hitSlop={8}
        style={({ pressed }) => [styles.discardBtn, pressed && styles.pressed]}
      >
        <Trash2 size={16} color={colors.danger} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  retryAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
  },
  retryAllLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 8,
  },
  emptyWrap: {
    minHeight: 200,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  rowError: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
  },
  discardBtn: {
    padding: 8,
  },
  pressed: {
    opacity: 0.85,
  },
});
