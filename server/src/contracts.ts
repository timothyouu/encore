export type { ReferenceNote, Passage, DetectedNote, Finding, AnalysisResult, CoachingResult, CoachRequest } from '../../shared/contracts.js';

export type RecordingMetadata = {
  attemptId: string;
  passageId: string;
  passageVersion: string;
  attemptTempoBpm: number;
  sourceSampleRate: number;
  sampleRate: 22050;
  channels: 1;
  encoding: 'pcm_s16le';
  durationSec: number;
  captureSource: 'phone' | 'test';
};
export type RecordingReceipt = RecordingMetadata & {
  artifactId: string;
  audioUrl: string;
  expiresAt: string;
  sha256: string;
  mimeType: 'audio/wav';
};

