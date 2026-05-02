/**
 * Tag-performers sheet — `/show/[id]/tag/[mediaId]`.
 *
 * Bottom-sheet style screen (presented as a full-screen modal so we can
 * route to it directly from the lightbox). Shows the show's existing
 * cast/lineup with checkbox-style toggle. Tapping Save calls
 * `media.setPerformers` and routes back.
 *
 * "Add not-listed" is intentionally deferred — it requires creating a new
 * performer row, which is M3 territory.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Check, AlertCircle } from 'lucide-react-native';

import { TopBar } from '../../../../components/TopBar';
import { EmptyState } from '../../../../components/EmptyState';
import { useTheme } from '../../../../lib/theme';
import { trpc } from '../../../../lib/trpc';
import { CACHE_DEFAULTS } from '../../../../lib/cache';
import { RADII } from '../../../../lib/theme-utils';
import { useFeedback } from '../../../../lib/feedback';

interface ShowPerformer {
  performerId: string;
  name: string;
  role: string;
  characterName: string | null;
}

export default function TagSheetScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showToast } = useFeedback();
  const params = useLocalSearchParams<{ id: string; mediaId: string }>();
  const showId = typeof params.id === 'string' ? params.id : '';
  const mediaId = typeof params.mediaId === 'string' ? params.mediaId : '';

  const showQuery = trpc.shows.detail.useQuery(
    { showId },
    {
      enabled: showId.length > 0,
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );
  const mediaQuery = trpc.media.listForShow.useQuery(
    { showId },
    {
      enabled: showId.length > 0,
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );
  const utils = trpc.useUtils();
  const setPerformers = trpc.media.setPerformers.useMutation();

  const performers: ShowPerformer[] = useMemo(() => {
    type ShowPerformerRow = {
      role: string;
      sortOrder: number;
      characterName: string | null;
      performer: { id: string; name: string };
    };
    const data = showQuery.data as
      | { showPerformers?: ShowPerformerRow[] }
      | undefined;
    if (!data?.showPerformers) return [];
    return [...data.showPerformers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sp) => ({
        performerId: sp.performer.id,
        name: sp.performer.name,
        role: sp.role,
        characterName: sp.characterName,
      }));
  }, [showQuery.data]);

  const initialIds = useMemo(() => {
    const list = mediaQuery.data ?? [];
    const target = list.find((m) => m.id === mediaId);
    return new Set(target?.performerIds ?? []);
  }, [mediaQuery.data, mediaId]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // The selection state seeds from the loaded media row exactly once. We
  // can't use the query result as the source of truth on every render
  // because the user may toggle locally before saving.
  useEffect(() => {
    if (!hydrated && mediaQuery.data) {
      setSelected(new Set(initialIds));
      setHydrated(true);
    }
  }, [hydrated, mediaQuery.data, initialIds]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    try {
      await setPerformers.mutateAsync({
        assetId: mediaId,
        performerIds: Array.from(selected),
      });
      await utils.media.listForShow.invalidate({ showId });
      showToast({ kind: 'success', text: 'Tags saved' });
      if (router.canGoBack()) router.back();
      else router.replace(`/show/${showId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save tags';
      showToast({ kind: 'error', text: message });
    }
  };

  const close = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace(`/show/${showId}`))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Close"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const loading = showQuery.isLoading || mediaQuery.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Tag performers" eyebrow="MEDIA" leading={close} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : performers.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon={<AlertCircle size={32} color={colors.faint} strokeWidth={1.5} />}
            title="No performers on this show"
            subtitle="Add a performer to the lineup before tagging media."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
          <View style={styles.list}>
            {performers.map((p, i) => {
              const isOn = selected.has(p.performerId);
              return (
                <Pressable
                  key={p.performerId}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isOn }}
                  accessibilityLabel={p.name}
                  onPress={() => toggle(p.performerId)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: colors.surface,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderColor: colors.rule,
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: colors.ink }]}>{p.name}</Text>
                    <Text style={[styles.rowMeta, { color: colors.faint }]}>
                      {(p.characterName ? p.characterName : p.role).toUpperCase()}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: isOn ? colors.accent : 'transparent',
                        borderColor: isOn ? colors.accent : colors.ruleStrong,
                      },
                    ]}
                  >
                    {isOn ? <Check size={14} color={colors.accentText} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      <View
        style={[
          styles.footer,
          {
            paddingBottom: 12 + insets.bottom,
            backgroundColor: colors.surface,
            borderTopColor: colors.rule,
          },
        ]}
      >
        <Pressable
          disabled={setPerformers.isPending}
          onPress={() => void save()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.accent },
            pressed && { opacity: 0.85 },
          ]}
        >
          {setPerformers.isPending ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={[styles.primaryLabel, { color: colors.accentText }]}>Save</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 16,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowName: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
  },
});
