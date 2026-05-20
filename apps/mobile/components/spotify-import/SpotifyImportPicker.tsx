/**
 * SpotifyImportPicker (mobile) — list of resolved Spotify-followed
 * artists with checkboxes + TM-match status. Mirrors the web
 * `apps/web/components/preferences/SpotifyImportPicker.tsx`.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, Search, X } from 'lucide-react-native';
import { useTheme } from '../../lib/theme';
import { RemoteImage } from '../design-system';
import type {
  SpotifyImportArtist,
  SpotifyImportFlow,
} from '../../lib/spotify-import/useSpotifyImport';

interface SpotifyImportPickerProps {
  flow: SpotifyImportFlow;
}

export function SpotifyImportPicker({ flow }: SpotifyImportPickerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const list = flow.artists ?? [];
    if (!trimmed) return list;
    return list.filter((a) => a.name.toLowerCase().includes(trimmed));
  }, [flow.artists, trimmed]);

  if (flow.phase === 'loading' || flow.phase === 'idle') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
        <Text style={[styles.centerLabel, { color: colors.muted }]}>
          Reading your Spotify follows…
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.filterRow, { borderBottomColor: colors.rule }]}>
        <Search size={14} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter artists…"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.filterInput, { color: colors.ink }]}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear">
            <X size={14} color={colors.muted} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      <View
        style={[
          styles.statsBar,
          { borderBottomColor: colors.rule, backgroundColor: colors.surfaceRaised },
        ]}
      >
        <View style={styles.statsInner}>
          <Stat value={flow.counts.selected} label="selected" emphasize />
          <Sep />
          <Stat value={flow.counts.importable} label="importable" />
          <Sep />
          <Stat value={flow.counts.total} label="from spotify" faint />
        </View>
        {flow.counts.importable > 0 ? (
          <View style={styles.bulkActions}>
            {flow.counts.selected < flow.counts.importable ? (
              <Pressable
                onPress={flow.selectAll}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Select all artists"
              >
                <Text style={[styles.selectAll, { color: colors.muted }]}>
                  Select all
                </Text>
              </Pressable>
            ) : null}
            {flow.counts.selected > 0 &&
            flow.counts.selected < flow.counts.importable ? (
              <Text style={[styles.selectAll, { color: colors.faint }]}>·</Text>
            ) : null}
            {flow.counts.selected > 0 ? (
              <Pressable
                onPress={flow.deselectAll}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Deselect all artists"
              >
                <Text style={[styles.selectAll, { color: colors.muted }]}>
                  Deselect all
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <Text style={[styles.empty, { color: colors.muted }]}>
            {trimmed
              ? 'No artists match your filter.'
              : 'Spotify returned no followed artists.'}
          </Text>
        ) : (
          filtered.map((row) => <ImportRow key={row.spotifyId} row={row} flow={flow} />)
        )}
      </ScrollView>
    </View>
  );
}

function ImportRow({
  row,
  flow,
}: {
  row: SpotifyImportArtist;
  flow: SpotifyImportFlow;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const importable = Boolean(row.tmMatch) && !row.alreadyFollowed;
  const checked = flow.selected.has(row.spotifyId);

  // Three states — already followed (locked, faded), unmatched (locked,
  // amber sub-label), importable (interactive). Match web semantics.
  let sub: string | null = null;
  if (row.alreadyFollowed) sub = 'already following';
  else if (!row.tmMatch) sub = 'no tm match';
  else if (row.genres.length > 0) sub = row.genres.slice(0, 2).join(' · ');

  return (
    <Pressable
      onPress={() => flow.toggle(row.spotifyId, importable)}
      disabled={!importable}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.rule,
          opacity: !importable ? 0.45 : pressed ? 0.7 : checked ? 1 : 0.7,
        },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !importable }}
      accessibilityLabel={row.name}
    >
      <Checkbox checked={checked} disabled={!importable} />
      <RemoteImage
        uri={row.tmMatch?.imageUrl ?? row.imageUrl}
        name={row.name}
        kind="concert"
        size="custom"
        width={36}
        height={36}
        style={styles.thumb}
      />
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
          {row.name}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { color: colors.faint }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Checkbox({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const borderColor = disabled ? colors.rule : checked ? colors.accent : colors.ruleStrong;
  const bg = checked && !disabled ? colors.accent : 'transparent';
  return (
    <View style={[styles.checkbox, { borderColor, backgroundColor: bg }]}>
      {checked && !disabled ? (
        <Check size={12} color={colors.accentText} strokeWidth={3} />
      ) : null}
    </View>
  );
}

function Stat({
  value,
  label,
  emphasize,
  faint,
}: {
  value: number;
  label: string;
  emphasize?: boolean;
  faint?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const valueColor = emphasize ? colors.accent : faint ? colors.faint : colors.ink;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

function Sep(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return <Text style={{ color: colors.faint }}>·</Text>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  centerLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterInput: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 14,
    paddingVertical: 0,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  statsInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectAll: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bulkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statValue: {
    fontFamily: 'Geist Mono',
    fontSize: 12,
    fontWeight: '600',
  },
  statLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  list: {
    flex: 1,
  },
  empty: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    borderRadius: 4,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  sub: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});
