export interface SnapshotSet {
  readonly screenshotPath: string;
  readonly a11yPath: string;
  readonly htmlPath: string;
}

export interface ElementCapture {
  readonly locatorDescription: string;
  readonly action: string;
  readonly screenshotPath: string;
}

export interface CommandRecord {
  readonly id: number;
  readonly command: string;
  readonly explanation: string | undefined;
  readonly assignTo: string | undefined;
  removed: boolean;
  readonly beforeSnapshots: SnapshotSet;
  readonly afterSnapshots: SnapshotSet;
  readonly error: string | undefined;
  readonly elementScreenshots: readonly ElementCapture[];
}

export interface StartSessionParams {
  readonly output_file?: string | undefined;
  readonly artifacts_dir?: string | undefined;
}
