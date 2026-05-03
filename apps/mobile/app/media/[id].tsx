/**
 * Lightbox modal — `/media/[id]`.
 *
 * Full-screen swipeable pager over the show's media list. The current
 * asset is selected by id, but the pager scrolls horizontally over the
 * whole batch so neighbour photos load in the background.
 *
 * Pinch-zoom uses react-native-gesture-handler (already installed for
 * the bottom sheet) — no extra deps. Caption + tag-count overlay sits
 * over the image; tapping "Tag performers" routes to the M4 TagSheet.
 *
 * The fetched list is the same `media.listForShow` query ShowDetail uses,
 * so cached entries hydrate instantly via the persister.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronLeft, Tag, AlertCircle } from 'lucide-react-native';

import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { CACHE_DEFAULTS } from '../../lib/cache';
import { RADII } from '../../lib/theme-utils';

interface MediaListItem {
  id: string;
  showId: string;
  caption: string | null;
  performerIds: string[];
  urls: Record<string, string>;
}

export default function LightboxScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; showId?: string }>();
  const mediaId = typeof params.id === 'string' ? params.id : '';

  // useWindowDimensions reflows on rotation — important for iPad
  // landscape where the static `Dimensions.get('window')` snapshot from
  // module-load time would freeze the pager at the launch orientation.
  const { width: screenW, height: screenH } = useWindowDimensions();

  // The lightbox needs the showId to fetch the sibling list. When the
  // caller doesn't pass it (e.g. deep-link from a notification), fall back
  // to a single-item fetch via byId.
  const passedShowId = typeof params.showId === 'string' ? params.showId : null;

  const byIdQuery = trpc.media.listForShow.useQuery(
    { showId: passedShowId ?? '' },
    {
      enabled: passedShowId !== null,
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );

  const items = useMemo<MediaListItem[]>(() => {
    return (byIdQuery.data ?? []).map((dto) => ({
      id: dto.id,
      showId: dto.showId,
      caption: dto.caption,
      performerIds: dto.performerIds,
      urls: dto.urls,
    }));
  }, [byIdQuery.data]);

  const initialIndex = useMemo(() => {
    const i = items.findIndex((m) => m.id === mediaId);
    return i < 0 ? 0 : i;
  }, [items, mediaId]);

  // `activeIndex` initializes to 0 (items is empty on first render) and
  // would stay there until the user manually scrolls — making the
  // bottom-bar counter and `active` lookup show the wrong row. Snap it
  // to `initialIndex` once the items list resolves.
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<MediaListItem>>(null);
  const initialApplied = useRef(false);
  useEffect(() => {
    if (initialApplied.current) return;
    if (items.length === 0) return;
    initialApplied.current = true;
    setActiveIndex(initialIndex);
  }, [items.length, initialIndex]);

  const close = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={[styles.iconBtn, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
    >
      <ChevronLeft size={22} color="#fff" strokeWidth={2} />
    </Pressable>
  );

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenW);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const active = items[activeIndex];

  return (
    <View style={[styles.root, { backgroundColor: '#000' }]}>
      {byIdQuery.isLoading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <AlertCircle size={32} color={colors.faint} strokeWidth={1.5} />
          <Text style={[styles.fallback, { color: '#fff' }]}>Media not found</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: screenW,
            offset: screenW * index,
            index,
          })}
          onMomentumScrollEnd={onMomentumEnd}
          renderItem={({ item }) => (
            <ZoomablePage item={item} width={screenW} height={screenH} />
          )}
        />
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>{close}</View>

      {active ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          {active.caption ? (
            <Text style={styles.caption} numberOfLines={3}>
              {active.caption}
            </Text>
          ) : null}
          <View style={styles.bottomActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tag performers"
              onPress={() => router.push(`/show/${active.showId}/tag/${active.id}`)}
              style={({ pressed }) => [
                styles.tagBtn,
                { backgroundColor: 'rgba(255,255,255,0.12)' },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Tag size={14} color="#fff" strokeWidth={2} />
              <Text style={styles.tagBtnText}>
                {active.performerIds.length > 0
                  ? `Tagged · ${active.performerIds.length}`
                  : 'Tag performers'}
              </Text>
            </Pressable>
            <Text style={styles.counter}>
              {activeIndex + 1} / {items.length}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ZoomablePage({
  item,
  width,
  height,
}: {
  item: MediaListItem;
  width: number;
  height: number;
}): React.JSX.Element {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(4, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.05) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  // Single-finger pan only fires when the image is zoomed; otherwise
  // the FlatList's horizontal pager handles single-finger swipes
  // between pages. The previous `minPointers(2)` requirement made the
  // zoomed image impossible to inspect with one finger.
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .enabled(true)
    .onStart(() => {
      // No-op — the gesture only emits onUpdate when scale > 1 thanks
      // to the manualActivation guard below.
    })
    .manualActivation(true)
    .onTouchesMove((_, state) => {
      // Only steal pan from the FlatList when the user has actually
      // zoomed in. While at scale 1, defer to the parent pager.
      if (scale.value > 1.01) state.activate();
      else state.fail();
    })
    .onUpdate((e) => {
      x.value = savedX.value + e.translationX;
      y.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      } else {
        scale.value = withTiming(2);
        savedScale.value = 2;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
    ],
  }));

  const uri = item.urls.large ?? item.urls.source ?? Object.values(item.urls)[0];

  return (
    <View style={[styles.page, { width, height }]}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.imageWrap, style]}>
          {uri ? (
            <Image
              source={{ uri }}
              style={styles.image}
              contentFit="contain"
              transition={200}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fallback: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: 12,
  },
  caption: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADII.pill,
  },
  tagBtnText: {
    color: '#fff',
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
  counter: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1,
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
