/**
 * MediaTab (mobile) — photo grid + "From the night" companion rows
 * (past) or "What we'll add automatically" preview rows (pre-show).
 *
 * The photo grid is the existing MediaGrid composed by the caller
 * (mirrors how the web tab takes a `mediaSection` slot).
 *
 * Past-show rows are real navigation affordances:
 *   - Ticket stub → opens the wallet-share how-to sheet (the importer
 *     itself is iOS share-sheet only; this is the discovery surface).
 *   - I Heard playlist → opens the existing Spotify playlist when one
 *     has been created, otherwise switches to the Setlist tab where
 *     `HypePlaylistCard` handles the connect + create flow. Gated on
 *     setlist availability + the hype-playlist feature flag.
 *   - Venue map → switches to the Map tab focused on this show's
 *     venue. Different intent from the Overview header venue link,
 *     which opens venue detail.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { ChevronRight, MapPin, Music, Ticket } from 'lucide-react-native';

import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { buildSpotifyOpenPlan } from '../../lib/setlist-intel';
import { SectionFrame } from './SectionFrame';
import { WalletShareHowToSheet } from '../WalletShareHowToSheet';

export interface MediaTabProps {
  isPast: boolean;
  mediaCount: number;
  photoGrid: React.ReactNode;
  /** Required for past-show row interactivity (heard-playlist + venue map).
   *  Pre-show callers can omit; the pre-show rows are informational and
   *  ignore these fields. */
  showId?: string;
  venueId?: string | null;
  /** Number of songs in the saved setlist. Drives the "exportable"
   *  gate for the I Heard playlist row — when 0, the row is hidden. */
  setlistSongCount?: number;
  /** Hype-playlist feature flag value. Falsy hides the I Heard row
   *  regardless of setlist availability (matches HypePlaylistCard). */
  hypePlaylistEnabled?: boolean;
  /** Navigates the parent tabs view to the Setlist tab. Used when the
   *  user taps the I Heard row but no Spotify playlist exists yet —
   *  the rich create UI lives there. */
  onSwitchToSetlistTab?: () => void;
}

export function MediaTab(props: MediaTabProps): React.JSX.Element {
  const { isPast, mediaCount, photoGrid } = props;
  return (
    <View testID="show-tab-media">
      <SectionFrame title="Photos" count={mediaCount}>
        {photoGrid}
      </SectionFrame>
      <SectionFrame title={isPast ? 'From the night' : "What we'll add automatically"}>
        {isPast ? <PastNightRows {...props} /> : <PreShowRows />}
      </SectionFrame>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Past-show rows — real navigation affordances
// ---------------------------------------------------------------------------

function PastNightRows({
  showId,
  venueId,
  setlistSongCount = 0,
  hypePlaylistEnabled = false,
  onSwitchToSetlistTab,
}: MediaTabProps): React.JSX.Element {
  const router = useRouter();
  const [walletSheetOpen, setWalletSheetOpen] = React.useState(false);

  // Query the existing playlist only when the row is going to render.
  // React Query dedupes against HypePlaylistCard's identical query when
  // both surfaces are mounted, so this is cheap.
  const playlistShown = Boolean(
    hypePlaylistEnabled && setlistSongCount > 0 && showId,
  );
  const existingQuery = trpc.spotify.existingPlaylist.useQuery(
    { showId: showId ?? '', kind: 'heard' },
    { enabled: playlistShown },
  );
  const existing = existingQuery.data ?? null;

  const openHeardPlaylist = React.useCallback(async () => {
    if (existing && existing.spotifyUrl) {
      const plan = buildSpotifyOpenPlan(existing.spotifyUrl);
      if (plan.primary && plan.primary !== plan.fallback) {
        try {
          await Linking.openURL(plan.primary);
          return;
        } catch {
          // Spotify app not installed — fall through to the web URL.
        }
      }
      if (plan.fallback) {
        try {
          await WebBrowser.openBrowserAsync(plan.fallback);
        } catch {
          await Linking.openURL(plan.fallback);
        }
      }
      return;
    }
    // No playlist yet — route the user to the Setlist tab where the
    // existing HypePlaylistCard handles the Spotify connect + create
    // flow with full status feedback.
    onSwitchToSetlistTab?.();
  }, [existing, onSwitchToSetlistTab]);

  const openVenueOnMap = React.useCallback(() => {
    if (!venueId) return;
    router.push({
      pathname: '/map',
      params: { focusVenueId: venueId },
    });
  }, [router, venueId]);

  return (
    <View>
      <NightRow
        icon={Ticket}
        title="Ticket stub"
        sub="Import from Apple Wallet"
        onPress={() => setWalletSheetOpen(true)}
        testID="from-night-ticket-stub"
      />
      {playlistShown ? (
        <NightRow
          icon={Music}
          title="I Heard playlist"
          sub={
            existing && existing.spotifyUrl
              ? 'Open in Spotify'
              : 'Save tonight’s setlist to Spotify'
          }
          onPress={() => {
            void openHeardPlaylist();
          }}
          testID="from-night-heard-playlist"
        />
      ) : null}
      {venueId ? (
        <NightRow
          icon={MapPin}
          title="Venue map"
          sub="See it on your map"
          onPress={openVenueOnMap}
          testID="from-night-venue-map"
          isLast
        />
      ) : null}
      <WalletShareHowToSheet
        open={walletSheetOpen}
        onClose={() => setWalletSheetOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pre-show preview rows — informational (no tap)
// ---------------------------------------------------------------------------

const PRE_STUBS: { icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>; title: string; sub: string }[] = [
  { icon: Ticket, title: 'Ticket stub', sub: 'From Apple Wallet, when you share it in' },
  { icon: Music, title: 'Live playlist', sub: 'Builds itself after the setlist syncs' },
  { icon: MapPin, title: 'Venue map', sub: 'Shows up on your map automatically' },
];

function PreShowRows(): React.JSX.Element {
  return (
    <View>
      {PRE_STUBS.map((stub, idx) => (
        <NightRow
          key={stub.title}
          icon={stub.icon}
          title={stub.title}
          sub={stub.sub}
          isLast={idx === PRE_STUBS.length - 1}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row primitive — matches the compact ShowCard rhythm (icon · title · sub
// · chevron), hairline rule between rows, no surface fill.
// ---------------------------------------------------------------------------

interface NightRowProps {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  title: string;
  sub: string;
  onPress?: () => void;
  testID?: string;
  isLast?: boolean;
}

function NightRow({
  icon: Icon,
  title,
  sub,
  onPress,
  testID,
  isLast = false,
}: NightRowProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const interactive = Boolean(onPress);

  const content = (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
      ]}
    >
      <View
        style={[styles.iconBubble, { backgroundColor: colors.surfaceRaised }]}
      >
        <Icon size={15} color={colors.muted} strokeWidth={1.8} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {interactive ? (
        <View style={styles.chevron}>
          <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
        </View>
      ) : null}
    </View>
  );

  if (!interactive) {
    return (
      <View testID={testID} accessible accessibilityRole="text">
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} — ${sub}`}
      testID={testID}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingRight: 4,
  },
  pressed: {
    opacity: 0.65,
  },
  iconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    fontWeight: '500',
  },
  sub: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    lineHeight: 16,
  },
  chevron: {
    justifyContent: 'center',
    paddingLeft: 4,
  },
});
