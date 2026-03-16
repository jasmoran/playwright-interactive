import type {
  CommandRecord,
  ElementCapture,
  PageSnapshotSet,
} from "../types.js";

export interface NewCommandInput {
  readonly command: string;
  readonly explanation: string | undefined;
  readonly assignTo: string | undefined;
  readonly beforeSnapshots: readonly PageSnapshotSet[];
  readonly afterSnapshots: readonly PageSnapshotSet[];
  readonly error: string | undefined;
  readonly elementScreenshots: readonly ElementCapture[];
}

export class CommandRegistry {
  private readonly commands: CommandRecord[] = [];
  private nextId = 1;

  addCommand(input: NewCommandInput): CommandRecord {
    const record: CommandRecord = {
      id: this.nextId++,
      command: input.command,
      explanation: input.explanation,
      assignTo: input.assignTo,
      removed: false,
      beforeSnapshots: input.beforeSnapshots,
      afterSnapshots: input.afterSnapshots,
      error: input.error,
      elementScreenshots: input.elementScreenshots,
    };
    this.commands.push(record);
    return record;
  }

  removeCommand(id: number): CommandRecord | undefined {
    const record = this.commands.find((c) => c.id === id);
    if (record && !record.removed) {
      record.removed = true;
      return record;
    }
    return undefined;
  }

  getActiveCommands(): readonly CommandRecord[] {
    return this.commands.filter((c) => !c.removed);
  }

  peekNextId(): number {
    return this.nextId;
  }

  getAllCommands(): readonly CommandRecord[] {
    return this.commands;
  }
}
