/**
 * Integration manage screen — pushed from the Me tab integration rows.
 *
 * Spotify has its own static route (`integrations/spotify.tsx`) so it
 * never lands here. The remaining three rows split into two buckets:
 *
 *   - Ticketmaster + Google Places are app-wide API keys baked into the
 *     Showbook backend (`TICKETMASTER_API_KEY` / `GOOGLE_PLACES_API_KEY`).
 *     They power show enrichment + the city / venue search on every
 *     signed-in account without any per-user connect step, so the
 *     detail screen explains the always-on status instead of dead-ending
 *     on "Not yet on mobile".
 *   - Gmail is a per-user OAuth scan flow on web. The mobile OAuth
 *     bridge isn't wired up yet, so we keep the existing
 *     "manage from web" placeholder for that row.
 */

import React from 'react';
import { View, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Plug,
  Check,
  MapPin,
  Ticket,
} from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../lib/theme';

type IntegrationId = 'gmail' | 'ticketmaster' | 'google-places' | 'spotify';

interface IntegrationCopy {
  title: string;
  /** "Built-in" rows: app-wide API key, always-on. */
  builtIn?: {
    icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
    blurb: string;
    /** Comma-separated list of what this data source powers. */
    powers: readonly string[];
  };
}

const INTEGRATIONS: Record<IntegrationId, IntegrationCopy> = {
  gmail: { title: 'Gmail' },
  ticketmaster: {
    title: 'Ticketmaster',
    builtIn: {
      icon: Ticket,
      blurb:
        'Showbook talks to the Ticketmaster Discovery API through a shared, app-wide key — no per-account sign-in needed.',
      powers: [
        'Venue details + seat / pricing on imported shows',
        'Performer images + tour information',
        'Resale-marketplace announcements in your regions',
      ],
    },
  },
  'google-places': {
    title: 'Google Places',
    builtIn: {
      icon: MapPin,
      blurb:
        'Showbook uses Google Places under a shared, app-wide key. Search results and coordinates come back to your device without you connecting an account.',
      powers: [
        'City search when adding a region',
        'Venue lookup + follow-from-search',
        'Map photos + addresses for venue cards',
      ],
    },
  },
  spotify: { title: 'Spotify' },
};

export default function IntegrationStub(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const integration: IntegrationCopy | null =
    id && id in INTEGRATIONS ? INTEGRATIONS[id as IntegrationId] : null;
  const title = integration?.title ?? 'Integration';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title={title}
        eyebrow="MANAGE INTEGRATION"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
          >
            <ChevronLeft size={22} color={colors.ink} />
            <Text style={[styles.backLabel, { color: colors.muted }]}>Back</Text>
          </Pressable>
        }
      />
      {integration?.builtIn ? (
        <BuiltInIntegration
          title={title}
          icon={integration.builtIn.icon}
          blurb={integration.builtIn.blurb}
          powers={integration.builtIn.powers}
        />
      ) : (
        <EmptyState
          icon={<Plug size={40} color={colors.muted} />}
          title="Not yet on mobile"
          subtitle={`Connecting ${title} from mobile isn't wired up yet — for now, manage this integration from the web app.`}
        />
      )}
    </View>
  );
}

function BuiltInIntegration({
  title,
  icon: Icon,
  blurb,
  powers,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  blurb: string;
  powers: readonly string[];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View
        style={[
          styles.heroCard,
          { backgroundColor: colors.surface, borderColor: colors.rule },
        ]}
      >
        <View
          style={[styles.heroIcon, { backgroundColor: colors.accentFaded }]}
        >
          <Icon size={28} color={colors.accent} strokeWidth={2} />
        </View>
        <Text style={[styles.heroTitle, { color: colors.ink }]}>{title}</Text>
        <View style={styles.statusRow}>
          <Check size={14} color={colors.accent} strokeWidth={2.5} />
          <Text style={[styles.statusLabel, { color: colors.accent }]}>
            CONNECTED · BUILT-IN
          </Text>
        </View>
        <Text style={[styles.blurb, { color: colors.muted }]}>{blurb}</Text>
      </View>

      <Text style={[styles.sectionLabel, { color: colors.muted }]}>
        WHAT IT POWERS
      </Text>
      <View
        style={[
          styles.card,
          styles.cardNoPad,
          { backgroundColor: colors.surface, borderColor: colors.rule },
        ]}
      >
        {powers.map((power, i) => (
          <View
            key={power}
            style={[
              styles.powerRow,
              i < powers.length - 1 && {
                borderBottomColor: colors.rule,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Check size={14} color={colors.accent} strokeWidth={2} />
            <Text style={[styles.powerText, { color: colors.ink }]}>{power}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.footer, { color: colors.faint }]}>
        No per-user sign-in — this data source is shared across every
        Showbook account.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '500',
  },
  scroll: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  heroCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.9,
  },
  blurb: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  cardNoPad: {
    padding: 0,
    overflow: 'hidden',
  },
  powerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  powerText: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    paddingTop: 12,
    paddingHorizontal: 12,
  },
});
