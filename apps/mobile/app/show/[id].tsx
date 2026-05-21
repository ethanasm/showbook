/**
 * Show detail — Phase 10 4-tab redesign. Renders `ShowDetailTabsView`
 * against the `shows.detail` tRPC payload.
 *
 * Data: `trpc.shows.detail` returns the show row joined with venue and
 * showPerformers (each carrying its performer). The QueryClient has a
 * SQLite persister attached at app root, so any query that uses the
 * shared client (tRPC's hooks do) is persisted automatically.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AlertCircle } from 'lucide-react-native';
import type { PerformerSetlist } from '@showbook/shared';

import { EmptyState } from '../../components/EmptyState';
import { ShowActionSheet } from '../../components/ShowActionSheet';
import {
  ShowDetailTabsView,
  type ShowDetail as TabbedShowDetail,
} from '../../components/show-tabs/ShowDetailTabsView';
import { useTheme, type ShowState } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { CACHE_DEFAULTS } from '../../lib/cache';

interface ShowDetailVenue {
  id: string;
  name: string;
  city: string;
  stateRegion: string | null;
}
interface ShowDetailPerformer {
  id: string;
  name: string;
}
interface ShowDetailShowPerformer {
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
  characterName: string | null;
  performer: ShowDetailPerformer;
}
interface ShowDetail {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports' | 'film' | 'unknown';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  notes: string | null;
  ticketUrl: string | null;
  venue: ShowDetailVenue;
  showPerformers: ShowDetailShowPerformer[];
  setlists: Record<string, PerformerSetlist> | null;
}

export interface ShowDetailScreenProps {
  /** Override the route param — used by the iPad three-pane layout. */
  showIdProp?: string;
}

export default function ShowDetailScreen(
  props: ShowDetailScreenProps = {},
): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const paramId = typeof params.id === 'string' ? params.id : '';
  const showId = props.showIdProp ?? paramId;

  const query = trpc.shows.detail.useQuery(
    { showId },
    {
      enabled: showId.length > 0,
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );

  const show = query.data as ShowDetail | undefined;

  const [actionSheetOpen, setActionSheetOpen] = React.useState(false);

  const onBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/shows');
  };

  // The full-bleed hero owns its own chrome (back + more buttons floating
  // over the photo), so we skip a screen-level TopBar and let the hero
  // bleed under the status bar. Loading / error states still need the
  // top safe-area inset so the spinner doesn't render under the notch.
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="show-detail-tabs-root"
    >
      {query.isLoading ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : null}
      {query.isError && !show ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <EmptyState
            icon={<AlertCircle size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Couldn't load show"
            subtitle={query.error?.message ?? 'Try again in a moment.'}
            cta={{ label: 'Retry', onPress: () => void query.refetch() }}
          />
        </View>
      ) : null}
      {show ? (
        <ShowDetailTabsView
          show={show as TabbedShowDetail}
          onBack={onBack}
          onMore={() => setActionSheetOpen(true)}
          initialTab={
            typeof params.tab === 'string'
              ? (params.tab as 'overview' | 'setlist' | 'media' | 'notes')
              : undefined
          }
        />
      ) : null}
      {show ? (
        <ShowActionSheet
          open={actionSheetOpen}
          onClose={() => setActionSheetOpen(false)}
          showId={show.id}
          state={show.state as ShowState}
          popAfterDelete
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
