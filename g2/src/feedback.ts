import { correctionFor, detailFor, findingBeat, findingTitle, orderedFindings, referenceFor } from '../../mobile/src/feedback.ts'
import type { AttemptRecord } from '../../mobile/src/session.ts'
import type { Passage } from './passages.ts'

// Glasses wording for one saved attempt, from the same helpers the phone uses,
// so both describe the same finding (Where? What happened? What next?).
export type ResultView = {
  title: string
  // Spec §9: fixture results always carry a visible demo label.
  tag: string
  // Review: where and what happened, then one short cue.
  review: string
  // Guide: the correction for that finding; null when there is nothing to correct.
  guide: string | null
  // Position in the finding list, so swipes can page Review ⇄ Guide across
  // findings (spec §4: swipe down is the next feedback page, up the previous).
  index: number
  findings: number
}

export function resultView(record: AttemptRecord, passage: Passage, findingIndex: number): ResultView {
  const tag = (record.captureSource ?? 'demo') === 'demo' ? 'Demo' : ''
  const base = { title: passage.title, tag, index: 0, findings: 0 }
  const analysis = record.analysis
  if (!analysis || analysis.status !== 'ok') {
    // Trust before detail (spec §2): no musical claim from unclear audio.
    const unclear = analysis?.status === 'uncertain' || analysis?.status === 'insufficient_audio'
    return { ...base, review: unclear ? "I couldn't hear that clearly.\nTry again." : 'This result is unavailable.', guide: null }
  }
  const findings = orderedFindings(record, passage)
  if (!findings.length) {
    const { matchedNotes, expectedNotes } = analysis.metrics
    return { ...base, review: `No supported mistakes found.\n${matchedNotes} of ${expectedNotes} notes matched.`, guide: null }
  }
  const index = Math.min(Math.max(0, findingIndex), findings.length - 1)
  const finding = findings[index]
  const beat = findingBeat(finding, passage, record)
  const where = Number.isFinite(beat) && beat < Number.MAX_SAFE_INTEGER ? `Beat ${Math.floor(beat) + 1}` : 'Outside reference'
  const count = findings.length > 1 ? `  (${index + 1} of ${findings.length})` : ''
  const correction = correctionFor(finding, passage)
  const cue = record.coaching?.evidenceFindingIds.includes(finding.id) ? record.coaching.cue : correction
  const finger = referenceFor(finding, passage)?.suggestedFinger
  return {
    ...base,
    review: `${where} · ${findingTitle(finding)}${count}\n${detailFor(finding, passage, record)}\n${cue}`,
    guide: `${correction}${finger ? `\nSuggested finger ${finger} (authored)` : ''}`,
    index,
    findings: findings.length,
  }
}
