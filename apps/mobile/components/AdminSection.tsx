/**
 * AdminSection — operator-tools section appended to the bottom of the
 * Me screen, rendered only for users on the `ADMIN_EMAILS` allowlist.
 *
 * Visibility is gated by the `admin.amIAdmin` tRPC query, which the
 * server re-derives from the user row + allowlist on every call, so a
 * revoked admin loses the section on the next load. Non-admins (and
 * the loading / error states) render nothing.
 *
 * Each row is one admin job. Tapping a row opens a bottom sheet with
 * the job's full description and a Confirm / Cancel pair — nothing
 * fires without that explicit second tap. This mirrors the web
 * `/admin` page (`apps/web/app/(app)/admin/View.client.tsx`); the
 * eight actions and their copy are kept in sync with
 * `packages/api/src/routers/admin.ts`.
 *
 * These mutations deliberately bypass the offline outbox: they're
 * fire-and-forget operator jobs that hit live upstream APIs and carry
 * server-side results, not optimistic local-state writes. Replaying a
 * "backfill every venue" job after a cold start would be wrong, so the
 * Confirm button is gated on `network.online` instead. This matches
 * the direct-`useMutation` precedent in the festival-lineup / Spotify-
 * import hooks.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  MapPin,
  Ticket,
  TicketCheck,
  Trash2,
  ListMusic,
  MicVocal,
  Disc3,
  IdCard,
  Hash,
  Music,
  ChevronRight,
} from 'lucide-react-native';

import { Sheet } from './Sheet';
import { Button } from './design-system';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';
import { useAuth } from '../lib/auth';
import { useFeedback } from '../lib/feedback';
import { useNetwork } from '../lib/network';
import { trpc } from '../lib/trpc';
import {
  formatJobEnqueued,
  formatVenueBackfill,
  formatSetlistRetry,
  formatCorpusFill,
} from '../lib/admin-actions';

type IconComponent = React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

interface AdminAction {
  id: string;
  /** Row title + sheet header. */
  title: string;
  /** One-line row subtitle. */
  blurb: string;
  /** Full job description shown in the confirmation sheet. */
  description: string;
  /** Confirm-button label, action-specific (mirrors the web page). */
  confirmLabel: string;
  icon: IconComponent;
  /** Deletes rows — shows an extra warning note in the sheet. */
  destructive?: boolean;
  /** Needs a performer name / id before it can run. */
  performerInput?: boolean;
  /** True while this action's mutation is in flight. */
  pending: boolean;
  /** Runs the action and resolves to the success-toast summary. */
  run: () => Promise<string>;
}

export function AdminSection(): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { token } = useAuth();
  const { showToast } = useFeedback();
  const network = useNetwork();

  // Cheap "is this user an admin?" check — protected query that returns
  // false for non-admins. `enabled` mirrors the prefs query on the Me
  // screen so it doesn't 401 before a session exists.
  const adminQuery = trpc.admin.amIAdmin.useQuery(undefined, {
    enabled: Boolean(token),
  });

  const backfillCoordinates = trpc.admin.backfillVenueCoordinates.useMutation();
  const backfillTicketmaster = trpc.admin.backfillVenueTicketmaster.useMutation();
  const pruneOrphans = trpc.admin.enqueuePruneOrphanCatalog.useMutation();
  const setlistRetry = trpc.admin.enqueueSetlistRetry.useMutation();
  const corpusFill = trpc.admin.enqueueSetlistCorpusFill.useMutation();
  const corpusRefresh = trpc.admin.enqueueSetlistCorpusFillRefresh.useMutation();
  const performerMbids = trpc.admin.enqueueBackfillPerformerMbids.useMutation();
  const performerTicketmaster =
    trpc.admin.enqueueBackfillPerformerTicketmasterIds.useMutation();
  const performerSpotify =
    trpc.admin.enqueueBackfillPerformerSpotifyIds.useMutation();
  const showTicketUrls =
    trpc.admin.enqueueBackfillShowTicketUrls.useMutation();

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [performerQuery, setPerformerQuery] = React.useState('');

  const actions: AdminAction[] = [
    {
      id: 'venue-coordinates',
      title: 'Backfill venue coordinates',
      blurb: 'Geocode venues missing a location',
      description:
        'Geocodes every venue that has a city but is missing latitude, longitude, or state. Calls the Google Geocoding API once per incomplete venue — this spends API budget, so run it deliberately.',
      confirmLabel: 'Run backfill',
      icon: MapPin,
      pending: backfillCoordinates.isPending,
      run: async () => {
        const r = await backfillCoordinates.mutateAsync();
        return formatVenueBackfill('Geocoded', r.geocoded, r.failed, r.total);
      },
    },
    {
      id: 'venue-ticketmaster',
      title: 'Backfill Ticketmaster venue IDs',
      blurb: 'Match venues to Ticketmaster',
      description:
        "Looks up a Ticketmaster venue ID for every venue that doesn't have one yet. Calls the Ticketmaster Discovery API once per venue.",
      confirmLabel: 'Run backfill',
      icon: Ticket,
      pending: backfillTicketmaster.isPending,
      run: async () => {
        const r = await backfillTicketmaster.mutateAsync();
        return formatVenueBackfill('Matched', r.matched, r.failed, r.total);
      },
    },
    {
      id: 'prune-orphans',
      title: 'Prune orphaned records',
      blurb: 'Delete unreferenced venues & performers',
      description:
        'Enqueues the prune-orphan-catalog job, which deletes announcements, venues, and performers that have no remaining shows, follows, or references. This also runs nightly at 02:30 ET — use this for an on-demand sweep.',
      confirmLabel: 'Enqueue prune job',
      icon: Trash2,
      destructive: true,
      pending: pruneOrphans.isPending,
      run: async () => {
        const r = await pruneOrphans.mutateAsync();
        return formatJobEnqueued(r.jobId);
      },
    },
    {
      id: 'setlist-retry',
      title: 'Run setlist enrichment',
      blurb: 'Queue past shows missing a setlist',
      description:
        'Queues every past concert that is still missing a setlist, then triggers the setlist-retry job now. Calls setlist.fm once per show and respects the give-up marker on shows already exhausted.',
      confirmLabel: 'Run enrichment',
      icon: ListMusic,
      pending: setlistRetry.isPending,
      run: async () => {
        const r = await setlistRetry.mutateAsync();
        return formatSetlistRetry(r.queued, r.jobId);
      },
    },
    {
      id: 'corpus-fill',
      title: 'Refresh corpus for a performer',
      blurb: "Warm up one performer's setlist tab",
      description:
        'Enqueues a setlist-corpus-fill job for a single performer so their predicted-setlist tab can leave the cold state before an upcoming show. Enter a performer name, or paste a performer ID if the name is ambiguous.',
      confirmLabel: 'Enqueue corpus fill',
      icon: MicVocal,
      performerInput: true,
      pending: corpusFill.isPending,
      run: async () => {
        const r = await corpusFill.mutateAsync({
          performerQuery: performerQuery.trim(),
        });
        return formatCorpusFill(r.performerName, r.hasMbid);
      },
    },
    {
      id: 'corpus-refresh',
      title: 'Refresh corpus for all upcoming',
      blurb: 'Warm up every upcoming performer',
      description:
        'Triggers the setlist-corpus-fill-refresh sweep — the same job that runs daily at 04:45 ET. Refreshes corpus for the top-followed performers plus anyone with a show in the next 30 days, so expect 500+ setlist.fm calls.',
      confirmLabel: 'Enqueue refresh',
      icon: Disc3,
      pending: corpusRefresh.isPending,
      run: async () => {
        const r = await corpusRefresh.mutateAsync();
        return formatJobEnqueued(r.jobId);
      },
    },
    {
      id: 'performer-mbids',
      title: 'Backfill performer MBIDs',
      blurb: 'Resolve MusicBrainz IDs',
      description:
        'Enqueues the backfill-performer-mbids job, which looks up a MusicBrainz ID via setlist.fm for every performer that is missing one. Never overwrites an existing ID. Also runs daily at 04:30 ET.',
      confirmLabel: 'Enqueue backfill',
      icon: IdCard,
      pending: performerMbids.isPending,
      run: async () => {
        const r = await performerMbids.mutateAsync();
        return formatJobEnqueued(r.jobId);
      },
    },
    {
      id: 'performer-ticketmaster',
      title: 'Backfill performer TM IDs',
      blurb: 'Resolve Ticketmaster attraction IDs',
      description:
        'Enqueues the backfill-performer-ticketmaster-ids job, which looks up a Ticketmaster attraction ID for every performer that is missing one — and fills any MBID exposed along the way. Never overwrites existing IDs. Also runs daily at 06:00 ET.',
      confirmLabel: 'Enqueue backfill',
      icon: Hash,
      pending: performerTicketmaster.isPending,
      run: async () => {
        const r = await performerTicketmaster.mutateAsync();
        return formatJobEnqueued(r.jobId);
      },
    },
    {
      id: 'performer-spotify',
      title: 'Backfill performer Spotify IDs',
      blurb: 'Resolve Spotify catalog IDs',
      description:
        'Enqueues the backfill-performer-spotify-ids job, which looks up a Spotify catalog artist ID via /v1/search?type=artist for every performer that is missing one. Never overwrites existing IDs. Also runs daily at 06:30 ET.',
      confirmLabel: 'Enqueue backfill',
      icon: Music,
      pending: performerSpotify.isPending,
      run: async () => {
        const r = await performerSpotify.mutateAsync();
        return formatJobEnqueued(r.jobId);
      },
    },
    {
      id: 'show-ticket-urls',
      title: 'Backfill show ticket URLs',
      blurb: 'Find a Ticketmaster link for upcoming shows',
      description:
        "Enqueues the backfill-show-ticket-urls job, which looks up a Ticketmaster event URL for every future watching / ticketed show whose ticket_url is null. Gmail / Eventbrite imports land without one. Festivals and past shows are excluded. Also runs daily at 06:45 ET.",
      confirmLabel: 'Enqueue backfill',
      icon: TicketCheck,
      pending: showTicketUrls.isPending,
      run: async () => {
        const r = await showTicketUrls.mutateAsync();
        return formatJobEnqueued(r.jobId);
      },
    },
  ];

  const active = actions.find((a) => a.id === activeId) ?? null;
  // Hold the last-opened action so the sheet body stays rendered through
  // the slide-out animation (when `active` flips to null on close).
  // Updating a ref during render is the supported pattern for this.
  const lastActionRef = React.useRef<AdminAction | null>(null);
  if (active) lastActionRef.current = active;

  // Closed after all hooks so hook order is stable for non-admins.
  if (!adminQuery.data?.isAdmin) return null;

  const closeSheet = (): void => {
    setActiveId(null);
    setPerformerQuery('');
  };

  const confirmActive = async (): Promise<void> => {
    if (!active) return;
    try {
      const summary = await active.run();
      showToast({ kind: 'success', text: summary });
      closeSheet();
    } catch (err) {
      // Keep the sheet open on failure so the operator can read the
      // error (e.g. an ambiguous-performer candidate list) and retry.
      showToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Admin action failed',
      });
    }
  };

  return (
    <>
      <Text style={[styles.sectionLabel, { color: colors.muted }]}>ADMIN</Text>
      <View
        testID="admin-section"
        style={[
          styles.card,
          styles.cardNoPad,
          { backgroundColor: colors.surface, borderColor: colors.rule },
        ]}
      >
        {actions.map((action, i) => (
          <AdminRow
            key={action.id}
            action={action}
            isLast={i === actions.length - 1}
            onPress={() => setActiveId(action.id)}
          />
        ))}
      </View>

      <AdminActionSheet
        open={active !== null}
        action={active ?? lastActionRef.current}
        performerQuery={performerQuery}
        onPerformerQueryChange={setPerformerQuery}
        offline={!network.online}
        onConfirm={() => void confirmActive()}
        onClose={closeSheet}
      />
    </>
  );
}

function AdminRow({
  action,
  isLast,
  onPress,
}: {
  action: AdminAction;
  isLast: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const RowIcon = action.icon;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action.title}
      accessibilityHint="Opens a confirmation sheet for this admin job"
      testID={`admin-row-${action.id}`}
      style={({ pressed }) => [
        styles.row,
        !isLast && {
          borderBottomColor: colors.rule,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        pressed && styles.pressed,
      ]}
    >
      <RowIcon size={18} color={colors.muted} strokeWidth={2} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.ink }]}>
          {action.title}
        </Text>
        <Text
          style={[styles.rowSub, { color: colors.muted }]}
          numberOfLines={1}
        >
          {action.blurb}
        </Text>
      </View>
      {action.pending ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : (
        <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
      )}
    </Pressable>
  );
}

function AdminActionSheet({
  open,
  action,
  performerQuery,
  onPerformerQueryChange,
  offline,
  onConfirm,
  onClose,
}: {
  open: boolean;
  action: AdminAction | null;
  performerQuery: string;
  onPerformerQueryChange: (next: string) => void;
  offline: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const pending = action?.pending ?? false;
  const needsPerformer = action?.performerInput ?? false;
  const performerMissing =
    needsPerformer && performerQuery.trim().length === 0;
  const confirmDisabled = pending || offline || performerMissing;

  const SheetIcon = action?.icon ?? null;

  // The performer action carries an extra labelled text input, so it
  // needs more room than the description-only sheets. Two tiers keeps
  // each sheet close to its content height without a measure pass.
  const snapPoint = action?.performerInput ? '46%' : '40%';

  return (
    <Sheet open={open} onClose={onClose} snapPoints={[snapPoint]}>
      {action ? (
        <View style={sheetStyles.root}>
          <ScrollView
            style={sheetStyles.scroll}
            contentContainerStyle={sheetStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={sheetStyles.titleRow}>
              {SheetIcon ? (
                <View
                  style={[
                    sheetStyles.iconWrap,
                    { backgroundColor: colors.accentFaded },
                  ]}
                >
                  <SheetIcon size={18} color={colors.accent} strokeWidth={2} />
                </View>
              ) : null}
              <Text style={[sheetStyles.title, { color: colors.ink }]}>
                {action.title}
              </Text>
            </View>

            <Text style={[sheetStyles.description, { color: colors.muted }]}>
              {action.description}
            </Text>

            {needsPerformer ? (
              <View style={sheetStyles.field}>
                <Text
                  style={[sheetStyles.fieldLabel, { color: colors.faint }]}
                >
                  PERFORMER
                </Text>
                <TextInput
                  value={performerQuery}
                  onChangeText={onPerformerQueryChange}
                  placeholder="Performer name or ID"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending}
                  accessibilityLabel="Performer name or ID"
                  testID="admin-performer-input"
                  style={[
                    sheetStyles.input,
                    {
                      color: colors.ink,
                      borderColor: colors.rule,
                      backgroundColor: colors.surface,
                    },
                  ]}
                />
              </View>
            ) : null}

            {action.destructive ? (
              <View
                style={[sheetStyles.note, { borderColor: colors.rule }]}
              >
                <Trash2 size={13} color={colors.danger} strokeWidth={2} />
                <Text style={[sheetStyles.noteText, { color: colors.muted }]}>
                  This permanently deletes unreferenced rows — it cannot be
                  undone.
                </Text>
              </View>
            ) : null}

            {offline ? (
              <Text style={[sheetStyles.status, { color: colors.danger }]}>
                You are offline — reconnect to run admin jobs.
              </Text>
            ) : pending ? (
              <Text style={[sheetStyles.status, { color: colors.muted }]}>
                Running… this keeps going even if you close the sheet. We will
                show the result in a toast.
              </Text>
            ) : null}
          </ScrollView>

          <View
            style={[sheetStyles.footer, { borderTopColor: colors.rule }]}
          >
            <Button
              label="Cancel"
              variant="ghost"
              size="md"
              onPress={onClose}
              testID="admin-cancel"
            />
            <Button
              label={pending ? 'Running…' : action.confirmLabel}
              variant="primary"
              size="md"
              loading={pending}
              disabled={confirmDisabled}
              onPress={onConfirm}
              testID="admin-confirm"
            />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
  cardNoPad: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  rowSub: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  pressed: {
    opacity: 0.85,
  },
});

const sheetStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  description: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    fontWeight: '400',
    lineHeight: 20,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
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
    borderRadius: RADII.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
    padding: 10,
  },
  noteText: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  status: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
