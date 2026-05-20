/**
 * FestivalLineupPicker (mobile) — list of extracted artists with
 * checkboxes, tier toggles, and a filter input. Mirrors the web
 * `apps/web/components/add/FestivalLineupPicker.tsx`.
 */

import React, { useMemo, useState } from 'react';
import {
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
  FestivalArtistTier,
  FestivalLineupFlow,
  FestivalLineupRow,
} from '../../lib/festival-lineup/useFestivalLineup';

interface FestivalLineupPickerProps {
  flow: FestivalLineupFlow;
}

export function FestivalLineupPicker({ flow }: FestivalLineupPickerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!trimmed) return flow.rows;
    return flow.rows.filter((r) => r.name.toLowerCase().includes(trimmed));
  }, [flow.rows, trimmed]);

  return (
    <View style={styles.container}>
      {/* Filter row */}
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
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear filter"
          >
            <X size={14} color={colors.muted} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      {/* Stats bar */}
      <View
        style={[
          styles.statsBar,
          { borderBottomColor: colors.rule, backgroundColor: colors.surfaceRaised },
        ]}
      >
        <View style={styles.statsInner}>
          <Stat value={flow.counts.headliners} label="headliners" emphasize />
          <Sep />
          <Stat value={flow.counts.support} label="support" />
          <Sep />
          <Stat value={flow.counts.unselected} label="not selected" faint />
          {flow.isMatching ? (
            <>
              <Sep />
              <Text style={[styles.statsHint, { color: colors.faint }]}>matching…</Text>
            </>
          ) : null}
        </View>
        {flow.rows.length > 0 ? (
          <View style={styles.bulkActions}>
            {flow.selected.size < flow.rows.length ? (
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
            {flow.selected.size > 0 && flow.selected.size < flow.rows.length ? (
              <Text style={[styles.selectAll, { color: colors.faint }]}>·</Text>
            ) : null}
            {flow.selected.size > 0 ? (
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

      {/* List */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <Text style={[styles.empty, { color: colors.muted }]}>
            {trimmed
              ? 'No artists match your filter.'
              : "Couldn't read a lineup. Try another image or add the artists manually."}
          </Text>
        ) : (
          filtered.map((row) => (
            <LineupRow
              key={row.name}
              row={row}
              checked={flow.selected.has(row.name)}
              tier={flow.tierFor(row)}
              onToggle={() => flow.toggle(row.name)}
              onSetTier={(t) => flow.setTier(row.name, t)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function LineupRow({
  row,
  checked,
  tier,
  onToggle,
  onSetTier,
}: {
  row: FestivalLineupRow;
  checked: boolean;
  tier: FestivalArtistTier;
  onToggle: () => void;
  onSetTier: (tier: FestivalArtistTier) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.rule, opacity: pressed ? 0.7 : checked ? 1 : 0.55 },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={row.name}
    >
      <Checkbox checked={checked} />
      <RemoteImage
        uri={row.tmMatch?.imageUrl}
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
        {row.tmMatch === null ? (
          <Text style={[styles.sub, { color: colors.faint }]}>no tm match</Text>
        ) : null}
      </View>
      <TierToggle tier={tier} disabled={!checked} onChange={onSetTier} />
    </Pressable>
  );
}

function TierToggle({
  tier,
  disabled,
  onChange,
}: {
  tier: FestivalArtistTier;
  disabled?: boolean;
  onChange: (tier: FestivalArtistTier) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={[styles.tierToggle, { borderColor: colors.ruleStrong, opacity: disabled ? 0.4 : 1 }]}
    >
      <TierButton
        active={tier === 'headliner'}
        disabled={disabled}
        onPress={() => onChange('headliner')}
        label="Headliner"
      />
      <View style={[styles.tierDivider, { backgroundColor: colors.ruleStrong }]} />
      <TierButton
        active={tier === 'support'}
        disabled={disabled}
        onPress={() => onChange('support')}
        label="Support"
      />
    </View>
  );
}

function TierButton({
  active,
  disabled,
  onPress,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  label: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={[
        styles.tierBtn,
        { backgroundColor: active ? colors.accent : 'transparent' },
      ]}
    >
      <Text
        style={[
          styles.tierLabel,
          { color: active ? colors.accentText : colors.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Checkbox({ checked }: { checked: boolean }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={[
        styles.checkbox,
        {
          borderColor: checked ? colors.accent : colors.ruleStrong,
          backgroundColor: checked ? colors.accent : 'transparent',
        },
      ]}
    >
      {checked ? <Check size={12} color={colors.accentText} strokeWidth={3} /> : null}
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
  statsHint: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.5,
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
  listContent: {
    paddingBottom: 12,
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
  tierToggle: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tierDivider: {
    width: StyleSheet.hairlineWidth,
  },
  tierBtn: {
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tierLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
