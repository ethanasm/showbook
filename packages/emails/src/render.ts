import { render } from '@react-email/render';
import { DailyDigest, type DailyDigestProps } from './DailyDigest';
import { HealthSummary, type HealthSummaryProps } from './HealthSummary';
import { createElement } from 'react';

export async function renderDailyDigest(
  props: DailyDigestProps,
): Promise<string> {
  return render(createElement(DailyDigest, props));
}

export async function renderHealthSummary(
  props: HealthSummaryProps,
): Promise<string> {
  return render(createElement(HealthSummary, props));
}
