/**
 * Setlist composer.
 *
 * The user picks a performer (auto-selected when the show has just one),
 * then types tracks. Drag-to-reorder is wired via
 * `react-native-draggable-flatlist`. An "Encore" toggle on each row
 * splits the list into a main set + encore section. When setlist.fm
 * has a setlist for this performer + date, a borrow banner offers to
 * import it as a starting point.
 *
 * Persistence: the canonical mutation is `shows.setSetlist` which
 * upserts the per-performer entry. We post through the optimistic
 * runner so the row updates locally before the network call.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Plus,
  Save,
  ListMusic,
  Sparkles,
} from 'lucide-react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { useQueryClient } from '@tanstack/react-query';
import type {
  PerformerSetlist,
  SetlistSection,
} from '@showbook/shared';

import { TopBar } from '../../../components/TopBar';
import { SetlistRow } from '../../../components/SetlistRow';
import { EmptyState } from '../../../components/EmptyState';
import { useTheme } from '../../../lib/theme';
import { trpc } from '../../../lib/trpc';
import { useFeedback } from '../../../lib/feedback';
import { runOptimisticMutation } from '../../../lib/mutations';
import { createOutbox } from '../../../lib/cache/outbox';

interface ShowDetailLike {
  id: string;
  date: string | null;
  setlists: Record<string, PerformerSetlist> | null;
  showPerformers: {
    role: 'headliner' | 'support' | 'cast';
    sortOrder: number;
    performer: { id: string; name: string };
  }[];
}

interface DraftTrack {
  key: string;
  title: string;
  isEncore: boolean;
}

let _trackId = 0;
function newTrackKey(): string {
  _trackId += 1;
  return `t-${Date.now().toString(36)}-${_trackId}`;
}

function flattenSetlist(s: PerformerSetlist | undefined | null): DraftTrack[] {
  if (!s) return [];
  const out: DraftTrack[] = [];
  for (const section of s.sections) {
    for (const song of section.songs) {
      out.push({
        key: newTrackKey(),
        title: song.title,
        isEncore: section.kind === 'encore',
      });
    }
  }
  return out;
}

function tracksToSetlist(tracks: DraftTrack[]): PerformerSetlist {
  const main: SetlistSection = { kind: 'set', songs: [] };
  const encore: SetlistSection = { kind: 'encore', songs: [] };
  for (const t of tracks) {
    const title = t.title.trim();
    if (!title) continue;
    (t.isEncore ? encore : main).songs.push({ title });
  }
  const sections: SetlistSection[] = [];
  if (main.songs.length > 0) sections.push(main);
  if (encore.songs.length > 0) sections.push(encore);
  return { sections };
}

let _outboxSingleton: ReturnType<typeof createOutbox> | null = null;
function getOutbox(): ReturnType<typeof createOutbox> {
  if (_outboxSingleton) return _outboxSingleton;
  const rows = new Map<
    string,
    { id: string; mutation: string; payload: string; created_at: number; attempts: number; last_error: string | null }
  >();
  const db = {
    async execAsync() {},
    async runAsync(sql: string, params: unknown[] = []) {
      if (/^INSERT INTO pending_writes/i.test(sql)) {
        const [id, mutation, payload, created_at] = params as [string, string, string, number];
        rows.set(id, { id, mutation, payload, created_at, attempts: 0, last_error: null });
      } else if (/^DELETE FROM pending_writes WHERE id/i.test(sql)) {
        rows.delete((params as string[])[0]);
      } else if (/^DELETE FROM pending_writes/i.test(sql)) {
        rows.clear();
      } else if (/^UPDATE pending_writes/i.test(sql)) {
        const [error, id] = params as [string, string];
        const row = rows.get(id);
        if (row) {
          row.attempts += 1;
          row.last_error = error;
        }
      }
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      if (/FROM pending_writes WHERE id/i.test(sql)) {
        const r = rows.get((params as string[])[0]);
        return (r ?? null) as T | null;
      }
      return null;
    },
    async getAllAsync<T>() {
      return Array.from(rows.values()).sort((a, b) => a.created_at - b.created_at) as T[];
    },
  };
  _outboxSingleton = createOutbox(db, { ensureMigrations: false });
  return _outboxSingleton;
}

export default function SetlistComposerScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; performerId?: string }>();
  const showId = typeof params.id === 'string' ? params.id : '';
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  const detailQuery = trpc.shows.detail.useQuery({ showId }, { enabled: showId.length > 0 });
  const detail = detailQuery.data as ShowDetailLike | undefined;

  const performers = React.useMemo(() => {
    if (!detail) return [];
    return [...detail.showPerformers]
      .filter((sp) => sp.role !== 'cast')
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [detail]);

  const [activePerformerId, setActivePerformerId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!activePerformerId && performers.length > 0) {
      const requested =
        typeof params.performerId === 'string' ? params.performerId : null;
      const match = requested && performers.find((p) => p.performer.id === requested);
      setActivePerformerId(match ? match.performer.id : performers[0]!.performer.id);
    }
  }, [activePerformerId, performers, params.performerId]);

  const [tracks, setTracks] = React.useState<DraftTrack[]>([]);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!detail || !activePerformerId) return;
    if (loadedFor === activePerformerId) return;
    const existing = detail.setlists?.[activePerformerId];
    setTracks(flattenSetlist(existing));
    setLoadedFor(activePerformerId);
  }, [detail, activePerformerId, loadedFor]);

  const activePerformerName = React.useMemo(() => {
    return performers.find((p) => p.performer.id === activePerformerId)?.performer.name ?? null;
  }, [performers, activePerformerId]);

  // Borrow-from-setlist.fm — only fire once we have a performer + date.
  const borrowQuery = trpc.enrichment.fetchSetlist.useQuery(
    {
      performerName: activePerformerName ?? '',
      date: detail?.date ?? '',
    },
    {
      enabled: Boolean(activePerformerName && detail?.date),
      staleTime: 60_000,
    },
  );
  const borrowSuggestion = borrowQuery.data?.setlist ?? null;
  const canBorrow = Boolean(borrowSuggestion) && tracks.every((t) => !t.title.trim());

  const addTrack = React.useCallback((isEncore = false) => {
    setTracks((prev) => [
      ...prev,
      { key: newTrackKey(), title: '', isEncore },
    ]);
  }, []);

  const updateTrack = React.useCallback((key: string, patch: Partial<DraftTrack>) => {
    setTracks((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  const removeTrack = React.useCallback((key: string) => {
    setTracks((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const borrow = React.useCallback(() => {
    if (!borrowSuggestion) return;
    setTracks(flattenSetlist(borrowSuggestion));
    showToast({ kind: 'success', text: 'Borrowed from setlist.fm' });
  }, [borrowSuggestion, showToast]);

  const [saving, setSaving] = React.useState(false);

  const save = React.useCallback(async () => {
    if (!activePerformerId) return;
    const setlist = tracksToSetlist(tracks);
    setSaving(true);
    const detailKey = [['shows', 'detail'], { input: { showId }, type: 'query' }];
    try {
      await runOptimisticMutation({
        mutation: 'shows.setSetlist',
        input: { showId, performerId: activePerformerId, setlist },
        outbox: getOutbox(),
        call: (i) => utils.client.shows.setSetlist.mutate(i),
        optimistic: {
          snapshot: () => queryClient.getQueryData(detailKey),
          apply: () => {
            queryClient.setQueryData(detailKey, (prev: unknown) => {
              if (!prev || typeof prev !== 'object') return prev;
              const next = { ...(prev as { setlists?: Record<string, PerformerSetlist> | null }) };
              const setlists = { ...(next.setlists ?? {}) };
              if (setlist.sections.length === 0) delete setlists[activePerformerId];
              else setlists[activePerformerId] = setlist;
              next.setlists = Object.keys(setlists).length > 0 ? setlists : null;
              return next;
            });
          },
          rollback: (snap) => queryClient.setQueryData(detailKey, snap),
        },
        reconcile: () => {
          void utils.shows.detail.invalidate({ showId });
        },
      });
      showToast({ kind: 'success', text: 'Setlist saved' });
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save';
      showToast({ kind: 'error', text: message });
    } finally {
      setSaving(false);
    }
  }, [activePerformerId, tracks, utils, queryClient, showId, showToast, router]);

  // Track ordering: main set rows come first, then the encore divider, then
  // encore rows. Re-derive the sections from the resulting `isEncore` order
  // on save. Hooks have to live above the early returns below.
  const orderedTracks = React.useMemo(() => {
    const main = tracks.filter((t) => !t.isEncore);
    const enc = tracks.filter((t) => t.isEncore);
    return [...main, ...enc];
  }, [tracks]);

  if (!detail) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <TopBar
          title="Setlist"
          leading={
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
            </Pressable>
          }
        />
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      </View>
    );
  }

  if (performers.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <TopBar
          title="Setlist"
          leading={
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
            </Pressable>
          }
        />
        <EmptyState
          icon={<ListMusic size={36} color={colors.faint} strokeWidth={1.5} />}
          title="No performers yet"
          subtitle="Add a headliner from Edit before composing a setlist."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Setlist"
        eyebrow={activePerformerName?.toUpperCase()}
        leading={
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
          </Pressable>
        }
        rightAction={
          <Pressable
            onPress={() => void save()}
            hitSlop={10}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save"
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Save size={20} color={colors.accent} strokeWidth={2.2} />
            )}
          </Pressable>
        }
      />

      {performers.length > 1 ? (
        <View style={styles.performerStrip}>
          {performers.map((p) => {
            const active = p.performer.id === activePerformerId;
            return (
              <Pressable
                key={p.performer.id}
                onPress={() => {
                  setActivePerformerId(p.performer.id);
                  setLoadedFor(null);
                }}
                style={[
                  styles.performerChip,
                  {
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderColor: colors.rule,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.performerChipLabel,
                    { color: active ? colors.accentText : colors.muted },
                  ]}
                  numberOfLines={1}
                >
                  {p.performer.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {canBorrow ? (
        <View
          style={[
            styles.borrowBanner,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Text style={[styles.borrowText, { color: colors.muted }]} numberOfLines={2}>
            setlist.fm has a setlist for this date — borrow as a starting point?
          </Text>
          <Pressable
            onPress={borrow}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Borrow setlist"
          >
            <Text style={[styles.borrowAction, { color: colors.accent }]}>
              Borrow
            </Text>
          </Pressable>
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <DraggableFlatList<DraftTrack>
          data={orderedTracks}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListHeaderComponent={
            <SectionLabel
              icon={<ListMusic size={12} color={colors.faint} strokeWidth={2} />}
              label="Main set"
            />
          }
          renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<DraftTrack>) => {
            const idx = getIndex() ?? 0;
            const prev = orderedTracks[idx - 1];
            const showEncoreDivider = item.isEncore && (!prev || !prev.isEncore);
            const numberWithinSection = item.isEncore
              ? orderedTracks.slice(0, idx).filter((t) => t.isEncore).length + 1
              : idx + 1;
            return (
              <View
                style={[
                  isActive && { opacity: 0.85, backgroundColor: colors.surfaceRaised },
                ]}
              >
                {showEncoreDivider ? (
                  <SectionLabel
                    icon={<Sparkles size={12} color={colors.accent} strokeWidth={2} />}
                    label="Encore"
                    accent
                  />
                ) : null}
                <SetlistRow
                  trackNumber={numberWithinSection}
                  title={item.title}
                  isEncore={item.isEncore}
                  editable
                  onChangeTitle={(next) => updateTrack(item.key, { title: next })}
                  onLongPress={drag}
                  onRemove={() => removeTrack(item.key)}
                  testID={`setlist-row-${item.key}`}
                />
              </View>
            );
          }}
          onDragEnd={({ data }) => setTracks(data)}
          ListFooterComponent={
            <View style={styles.footer}>
              <Pressable
                onPress={() => addTrack(false)}
                style={[styles.addBtn, { borderColor: colors.rule }]}
                accessibilityRole="button"
                accessibilityLabel="Add track"
              >
                <Plus size={14} color={colors.muted} strokeWidth={2} />
                <Text style={[styles.addBtnText, { color: colors.muted }]}>
                  Add track
                </Text>
              </Pressable>
              <Pressable
                onPress={() => addTrack(true)}
                style={[styles.addBtn, { borderColor: colors.rule }]}
                accessibilityRole="button"
                accessibilityLabel="Add encore track"
              >
                <Sparkles size={14} color={colors.accent} strokeWidth={2} />
                <Text style={[styles.addBtnText, { color: colors.accent }]}>
                  Add encore track
                </Text>
              </Pressable>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function SectionLabel({
  icon,
  label,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={styles.sectionLabel}>
      {icon}
      <Text
        style={[
          styles.sectionLabelText,
          { color: accent ? tokens.colors.accent : tokens.colors.faint },
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  performerStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  performerChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  performerChipLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
  borrowBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  borrowText: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 12,
    lineHeight: 16,
  },
  borrowAction: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sectionLabelText: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    justifyContent: 'center',
  },
  addBtnText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '600',
  },
});
