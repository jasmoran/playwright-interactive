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
  readonly pom_paths?: readonly string[] | undefined;
  readonly output_file?: string | undefined;
  readonly artifacts_dir?: string | undefined;
}

export interface RunCommandParams {
  readonly command: string;
  readonly explanation?: string | undefined;
}

export interface RemoveCommandParams {
  readonly command_id: number;
}
