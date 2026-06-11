#!/usr/bin/env bash
# Emails the eas-cli error summary + a direct link to the EAS build page
# when a mobile-deploy job fails, so the failure is actionable from the
# inbox without digging through the Actions log to find the Expo link
# and then logging into expo.dev. Invoked from the `if: failure()` steps
# in .github/workflows/mobile-deploy.yml — the `ota` and `release` jobs
# share this script so the notifier logic isn't duplicated across jobs.
#
# Best-effort by design: always exits 0 so the notifier's own errors can
# never mask the real failure, and silently no-ops when the email
# secrets aren't configured.
#
# Expected env (set by the workflow step):
#   RESEND_API_KEY  — Resend API key
#   EMAIL_FROM      — verified Resend sender
#   ALERT_EMAILS    — comma-separated recipient list (ADMIN_EMAILS secret)
#   RUN_URL         — link to the Actions run
#   COMMIT_SHA      — the deployed commit
#   TRIGGER         — github.event_name
#   MODE            — update | build
# Reads the combined eas-cli output from $GITHUB_WORKSPACE/eas-output.log.

set +e  # never let the notifier's own errors mask the real failure
LOG="$GITHUB_WORKSPACE/eas-output.log"

if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${EMAIL_FROM:-}" ] || [ -z "${ALERT_EMAILS:-}" ]; then
  echo "::warning::Mobile-deploy failure email skipped — set RESEND_API_KEY, EMAIL_FROM and ADMIN_EMAILS secrets to enable it."
  exit 0
fi

SHORT_SHA="${COMMIT_SHA:0:7}"
SUBJECT="🔴 Mobile deploy failed — ${SHORT_SHA} (${TRIGGER}/${MODE})"

# Direct EAS build-page link(s) pulled from the captured CLI
# output (eas-cli prints "Build details: https://expo.dev/.../builds/<id>").
BUILD_LINKS=""
if [ -f "$LOG" ]; then
  BUILD_LINKS=$(grep -oiE 'https://expo\.dev/[^ ]*builds/[a-z0-9-]+' "$LOG" | sort -u | head -5)
fi

# eas-cli error summary: strip ANSI colour + carriage returns,
# HTML-escape, keep the tail (the failure reason is at the end).
if [ -f "$LOG" ]; then
  LOG_TAIL=$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" \
    | tr -d '\r' \
    | tail -c 14000 \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')
else
  LOG_TAIL="(no eas-cli output captured — the deploy failed before any EAS command ran; see the Actions run)"
fi

if [ -n "$BUILD_LINKS" ]; then
  BUILD_LINKS_HTML="<p><strong>EAS build page(s):</strong></p><ul>"
  while IFS= read -r url; do
    [ -n "$url" ] && BUILD_LINKS_HTML="${BUILD_LINKS_HTML}<li><a href=\"${url}\">${url}</a></li>"
  done <<< "$BUILD_LINKS"
  BUILD_LINKS_HTML="${BUILD_LINKS_HTML}</ul>"
else
  BUILD_LINKS_HTML="<p>No EAS build-page link found in the output (OTA update, or the failure happened before a build was queued).</p>"
fi

HTML="<h2>Mobile deploy failed</h2>
<p><strong>Commit:</strong> ${SHORT_SHA}<br>
<strong>Trigger:</strong> ${TRIGGER} / ${MODE}<br>
<strong>Actions run:</strong> <a href=\"${RUN_URL}\">${RUN_URL}</a></p>
${BUILD_LINKS_HTML}
<p><strong>eas-cli output (tail):</strong></p>
<pre style=\"background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;font-size:12px;line-height:1.4\">${LOG_TAIL}</pre>"

# Split ADMIN_EMAILS on commas into a JSON array for Resend's `to`.
TO_JSON=$(printf '%s' "$ALERT_EMAILS" \
  | jq -R 'split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0))')

PAYLOAD=$(jq -n \
  --arg from "$EMAIL_FROM" \
  --argjson to "$TO_JSON" \
  --arg subject "$SUBJECT" \
  --arg html "$HTML" \
  '{from:$from, to:$to, subject:$subject, html:$html}')

RESP=$(curl -sS -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
echo "Resend response: $RESP"
if printf '%s' "$RESP" | grep -q '"id"'; then
  echo "Failure-notification email sent."
else
  echo "::warning::Resend did not return a message id — the email may not have been delivered. See the response above."
fi
exit 0
