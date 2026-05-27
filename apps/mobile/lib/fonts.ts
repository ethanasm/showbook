/**
 * Font loader.
 *
 * Each `Font.loadAsync` key becomes the family name React Native resolves
 * `fontFamily: '<name>'` against. RN does NOT auto-pick a weighted face
 * for a registered family — `fontFamily: 'Geist Sans' + fontWeight: '600'`
 * would synthesize a fake bold over the loaded 400 face. The contract
 * here is therefore: callers spell the weight into the family name
 * (`'Geist Sans 600'`) and drop `fontWeight`. The unsuffixed aliases
 * (`'Geist Sans'` / `'Geist Mono'`) resolve to the 400 cut for the
 * handful of rows that legitimately want the default weight.
 *
 * Fraunces still only ships its 700 cut — that's the only weight the
 * type ramp references for the headliner / hero title.
 */

import * as Font from 'expo-font';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono/600SemiBold';
import { GeistMono_700Bold } from '@expo-google-fonts/geist-mono/700Bold';

export async function loadAppFonts(): Promise<void> {
  await Font.loadAsync({
    Fraunces: Fraunces_700Bold,
    'Geist Sans': Geist_400Regular,
    'Geist Sans 400': Geist_400Regular,
    'Geist Sans 500': Geist_500Medium,
    'Geist Sans 600': Geist_600SemiBold,
    'Geist Sans 700': Geist_700Bold,
    'Geist Mono': GeistMono_400Regular,
    'Geist Mono 400': GeistMono_400Regular,
    'Geist Mono 500': GeistMono_500Medium,
    'Geist Mono 600': GeistMono_600SemiBold,
    'Geist Mono 700': GeistMono_700Bold,
  });
}
