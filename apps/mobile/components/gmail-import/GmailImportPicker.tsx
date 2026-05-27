/**
 * GmailImportPicker (mobile) — list of scanned tickets with checkboxes
 * + duplicate badges. Mirrors the web review list in
 * `apps/web/components/shows-list/ShowsListView.tsx`.
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

import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import type { GmailImportFlow } from '@/lib/gmail-import/useGmailImport';
import type { GmailTicket } from '@/lib/gmail-import/types';

interface GmailImportPickerProps {
  flow: GmailImportFlow;
}

export function GmailImportPicker({ flow }: GmailImportPickerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!trimmed) return flow.tickets.map((t, i) => ({ t, i }));
    return flow.tickets
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        const hay = [
          t.headliner,
          t.production_name,
          t.venue_name,
          t.venue_city,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(trimmed);
      });
  }, [flow.tickets, trimmed]);

  return (
    <View style={styles.container}>
      <View style={[styles.filterRow, { borderBottomColor: colors.rule }]}>
        <Search size={14} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter tickets…"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.filterInput, { color: colors.ink, fontFamily: 'Geist Sans' }]}
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

      <View
        style={[
          styles.statsBar,
          { borderBottomColor: colors.rule, backgroundColor: colors.surfaceRaised },
        ]}
      >
        <View style={styles.statsInner}>
          <Stat value={flow.counts.selected} label="selected" emphasize />
          <Sep />
          <Stat value={flow.counts.selectable} label="new" />
          <Sep />
          <Stat value={flow.counts.duplicates} label="dupes" faint />
        </View>
        {flow.counts.selectable > 0 ? (
          <Pressable
            onPress={
              flow.counts.selected === flow.counts.selectable
                ? flow.deselectAll
                : flow.selectAll
            }
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={
              flow.counts.selected === flow.counts.selectable
                ? 'Deselect all'
                : 'Select all'
            }
          >
            <Text style={[styles.selectAll, { color: colors.muted, fontFamily: 'Geist Mono' }]}>
              {flow.counts.selected === flow.counts.selectable
                ? 'Deselect all'
                : 'Select all'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {flow.truncated ? (
          <Text style={[styles.truncated, { color: colors.muted, fontFamily: 'Geist Mono' }]}>
            Showing first 300 emails — narrow your inbox if you don&apos;t see a ticket.
          </Text>
        ) : null}
        {filtered.length === 0 ? (
          <Text style={[styles.empty, { color: colors.muted, fontFamily: 'Geist Mono' }]}>
            {trimmed
              ? 'No tickets match your filter.'
              : 'No tickets found in your inbox.'}
          </Text>
        ) : (
          filtered.map(({ t, i }) => (
            <ImportRow
              key={flow.ticketKey(t, i)}
              ticket={t}
              index={i}
              flow={flow}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ImportRow({
  ticket,
  index,
  flow,
}: {
  ticket: GmailTicket;
  index: number;
  flow: GmailImportFlow;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const duplicate = flow.isDuplicate(ticket);
  const key = flow.ticketKey(ticket, index);
  const checked = flow.selected.has(key);

  const subFragments: string[] = [];
  if (ticket.venue_name) subFragments.push(ticket.venue_name);
  if (ticket.venue_city) subFragments.push(ticket.venue_city);
  if (ticket.date) subFragments.push(ticket.date);
  if (ticket.seat) subFragments.push(ticket.seat);
  if (ticket.price) {
    subFragments.push(
      ticket.ticket_count && ticket.ticket_count > 1
        ? `$${ticket.price} · ${ticket.ticket_count} tix`
        : `$${ticket.price}`,
    );
  }

  return (
    <Pressable
      onPress={() => flow.toggle(key)}
      disabled={duplicate}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: duplicate }}
      accessibilityLabel={ticket.production_name ?? ticket.headliner}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.rule,
          opacity: duplicate ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Checkbox checked={checked} disabled={duplicate} />
      <View style={styles.rowBody}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, { color: colors.ink, fontFamily: 'Geist Sans' }]}
            numberOfLines={1}
          >
            {ticket.production_name ?? ticket.headliner}
          </Text>
          {duplicate ? (
            <Text
              style={[
                styles.dupBadge,
                {
                  color: colors.muted,
                  borderColor: colors.ruleStrong,
                  fontFamily: 'Geist Mono',
                },
              ]}
            >
              ALREADY ADDED
            </Text>
          ) : null}
        </View>
        {subFragments.length > 0 ? (
          <Text
            style={[styles.sub, { color: colors.muted, fontFamily: 'Geist Mono' }]}
            numberOfLines={1}
          >
            {subFragments.join(' · ')}
          </Text>
        ) : null}
        {ticket.kind_hint ? (
          <Text style={[styles.kind, { color: colors.faint, fontFamily: 'Geist Mono' }]}>
            {ticket.kind_hint.toUpperCase()}
            {ticket.confidence ? ` · ${ticket.confidence.toUpperCase()} CONFIDENCE` : ''}
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
      <Text style={[styles.statValue, { color: valueColor, fontFamily: 'Geist Mono' }]}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.faint, fontFamily: 'Geist Mono' }]}>
        {label}
      </Text>
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
    fontSize: 10,
    letterSpacing: 0.8,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  statLabel: {
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  list: {
    flex: 1,
  },
  truncated: {
    fontSize: 11,
    paddingHorizontal: 16,
    paddingVertical: 10,
    textAlign: 'center',
  },
  empty: {
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  dupBadge: {
    fontSize: 9,
    letterSpacing: 0.6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sub: {
    fontSize: 11,
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  kind: {
    fontSize: 9.5,
    letterSpacing: 0.7,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: RADII.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});
