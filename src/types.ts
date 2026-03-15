export interface SnapshotSet {
  readonly screenshotPath: string;
  readonly a11yPath: string;
  readonly htmlPath: string;
}

export interface CommandRecord {
  readonly id: number;
  readonly command: string;
  readonly explanation: string | undefined;
  removed: boolean;
  readonly beforeSnapshots: SnapshotSet;
  readonly afterSnapshots: SnapshotSet;
  readonly error: string | undefined;
}

export interface StartSessionParams {
  readonly output_file?: string | undefined;
  readonly artifacts_dir?: string | undefined;
}
