/**
 * Bottom sheet to rename a venue. Mirrors the web app's inline rename
 * affordance (`apps/web/components/EditableName.tsx`) — the server-side
 * authorization is the same (`venues.rename` requires the user to follow
 * the venue or have a show at it).
 *
 * Mutations route through `runOptimisticMutation` + the SQLite outbox so
 * a network failure leaves a retryable `venues.rename` row in
 * `pending_writes` instead of vanishing with a toast. The optimistic
 * patch updates every cache slot that holds the venue name — detail,
 * followed, list — so the new name is visible across the venues tab and
 * any show card that renders this venue immediately.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { Sheet } from './Sheet';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useFeedback } from '@/lib/feedback';
import { toUserMessage } from '@/lib/errors';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox } from '@/lib/cache';

export interface RenameVenueSheetProps {
  open: boolean;
  onClose: () => void;
  venueId: string;
  currentName: string;
  /** The shared, canonical venue name. When it differs from `currentName`
   *  the user has a personal alias and we surface a "reset to original". */
  canonicalName?: string;
  /** When true, also offer an admin-only "rename for everyone" action that
   *  edits the shared canonical name (`admin.renameVenue`). */
  isAdmin?: boolean;
}

const MAX_LEN = 300;

export function RenameVenueSheet({
  open,
  onClose,
  venueId,
  currentName,
  canonicalName,
  isAdmin = false,
}: RenameVenueSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  const [draft, setDraft] = React.useState(currentName);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setDraft(currentName);
      setSubmitting(false);
    }
  }, [open, currentName]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !submitting;
  // A personal alias exists when the displayed name differs from the
  // canonical one — only then is "reset to original" meaningful.
  const hasCustomName =
    canonicalName != null && canonicalName !== currentName;

  type DetailCache = { name?: string } | undefined;
  type FollowedCache = { id: string; name?: string }[] | undefined;
  type ListCache = { id: string; name?: string }[] | undefined;
  const detailKey = ['mobile', 'venue', venueId, 'detail'];
  const followedKey = ['mobile', 'venues', 'followed'];
  const listKey = ['mobile', 'venues', 'list'];

  // Capture the three name-bearing cache slots so the runner can roll back.
  const snapshotNameCaches = () => ({
    detail: queryClient.getQueryData<DetailCache>(detailKey),
    followed: queryClient.getQueryData<FollowedCache>(followedKey),
    list: queryClient.getQueryData<ListCache>(listKey),
  });

  const rollbackNameCaches = (snap: ReturnType<typeof snapshotNameCaches>) => {
    queryClient.setQueryData(detailKey, snap.detail);
    queryClient.setQueryData(followedKey, snap.followed);
    queryClient.setQueryData(listKey, snap.list);
  };

  // Optimistically write `name` into every cache slot that holds it.
  const writeNameToCaches = (name: string) => {
    queryClient.setQueryData<DetailCache>(detailKey, (prev) =>
      prev ? { ...prev, name } : prev,
    );
    queryClient.setQueryData<FollowedCache>(followedKey, (prev) =>
      prev?.map((v) => (v.id === venueId ? { ...v, name } : v)),
    );
    queryClient.setQueryData<ListCache>(listKey, (prev) =>
      prev?.map((v) => (v.id === venueId ? { ...v, name } : v)),
    );
  };

  const reconcileVenueCaches = () => {
    void utils.venues.detail.invalidate({ venueId });
    void utils.venues.followed.invalidate();
    void utils.venues.list.invalidate();
  };

  // Admin-only: edit the shared canonical name. Not routed through the
  // offline outbox — admin actions are online-only, matching AdminSection.
  const adminRename = trpc.admin.renameVenue.useMutation({
    onSuccess: () => {
      reconcileVenueCaches();
    },
  });

  const submitAdminRename = async (): Promise<void> => {
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await adminRename.mutateAsync({ venueId, name: trimmed });
      showToast({ kind: 'success', text: 'Canonical name updated' });
      onClose();
    } catch (err) {
      showToast({
        kind: 'error',
        text: toUserMessage(err, 'Could not update canonical name'),
      });
      setSubmitting(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      await runOptimisticMutation({
        mutation: 'venues.rename',
        input: { venueId, name: trimmed },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.venues.rename.mutate(input),
        optimistic: {
          snapshot: snapshotNameCaches,
          apply: () => writeNameToCaches(trimmed),
          rollback: rollbackNameCaches,
        },
        reconcile: reconcileVenueCaches,
      });
      showToast({ kind: 'success', text: 'Venue renamed' });
      onClose();
    } catch (err) {
      showToast({
        kind: 'error',
        text: toUserMessage(err, 'Could not rename venue'),
      });
      setSubmitting(false);
    }
  };

  const resetName = async (): Promise<void> => {
    if (canonicalName == null || submitting) return;
    setSubmitting(true);

    try {
      await runOptimisticMutation({
        mutation: 'venues.resetName',
        input: { venueId },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.venues.resetName.mutate(input),
        optimistic: {
          snapshot: snapshotNameCaches,
          apply: () => writeNameToCaches(canonicalName),
          rollback: rollbackNameCaches,
        },
        reconcile: reconcileVenueCaches,
      });
      showToast({ kind: 'success', text: 'Reset to original name' });
      onClose();
    } catch (err) {
      showToast({
        kind: 'error',
        text: toUserMessage(err, 'Could not reset venue name'),
      });
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['42%']}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.ink }]}>Rename venue</Text>
        <Text style={[styles.hint, { color: colors.muted }]}>
          Only you will see this name.
        </Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.faint }]}>NAME</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            maxLength={MAX_LEN}
            placeholder="Venue name"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            testID="rename-venue-input"
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
            accessibilityLabel="Save venue name"
            testID="rename-venue-save"
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: colors.accent,
                opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.confirmLabel, { color: colors.accentText }]}>
              {submitting ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        {hasCustomName && (
          <Pressable
            onPress={() => void resetName()}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Reset to original venue name"
            testID="rename-venue-reset"
            style={({ pressed }) => [
              styles.resetBtn,
              { opacity: submitting ? 0.5 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.resetLabel, { color: colors.muted }]}>
              Reset to original ({canonicalName})
            </Text>
          </Pressable>
        )}

        {isAdmin && (
          <Pressable
            onPress={() => void submitAdminRename()}
            disabled={trimmed.length === 0 || submitting}
            accessibilityRole="button"
            accessibilityLabel="Rename for everyone (admin)"
            testID="rename-venue-admin"
            style={({ pressed }) => [
              styles.resetBtn,
              {
                opacity:
                  trimmed.length === 0 || submitting ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.resetLabel, { color: colors.faint }]}>
              Admin · rename for everyone
            </Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  title: {
    fontFamily: 'Geist Sans 600',
    fontSize: 17,
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
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 1.05,
  },
  input: {
    fontFamily: 'Geist Sans 400',
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
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
    borderRadius: RADII.pill,
  },
  cancelLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
  },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: RADII.pill,
  },
  confirmLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
  resetBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  resetLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11.5,
    letterSpacing: 0.2,
  },
});
