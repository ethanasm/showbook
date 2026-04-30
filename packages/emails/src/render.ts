import { render } from '@react-email/render';
import { DailyDigest, type DailyDigestProps } from './DailyDigest';
import { createElement } from 'react';

export async function renderDailyDigest(
  props: DailyDigestProps,
): Promise<string> {
  return render(createElement(DailyDigest, props));
}
