import * as vscode from "vscode";
import { RunController } from "./run";

interface SlipwayTaskDefinition extends vscode.TaskDefinition {
  action: "build" | "run";
}

/** Exposes Build and Run as tasks; they reuse the commands, so the Problems panel stays in one place. */
export class SlipwayTaskProvider implements vscode.TaskProvider {
  constructor(private readonly runner: RunController) {}

  provideTasks(): vscode.Task[] {
    return [
      this.task({ type: "slipway", action: "build" }),
      this.task({ type: "slipway", action: "run" }),
    ];
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as SlipwayTaskDefinition;
    return definition.action === "build" || definition.action === "run"
      ? this.task(definition, task.scope)
      : undefined;
  }

  private task(
    definition: SlipwayTaskDefinition,
    scope: vscode.TaskScope | vscode.WorkspaceFolder = vscode.TaskScope.Workspace,
  ): vscode.Task {
    const label = definition.action === "build" ? "Build" : "Run on Device";
    const task = new vscode.Task(
      definition,
      scope,
      label,
      "slipway",
      new vscode.CustomExecution(async () => {
        const write = new vscode.EventEmitter<string>();
        const close = new vscode.EventEmitter<number>();
        return {
          onDidWrite: write.event,
          onDidClose: close.event,
          open: async () => {
            write.fire(`Slipway: ${label}. Output is in the "Slipway" log channel.\r\n`);
            if (definition.action === "build") {
              const app = await this.runner.build();
              close.fire(app ? 0 : 1);
            } else {
              await this.runner.run();
              close.fire(0);
            }
          },
          close: () => void this.runner.stop(),
        };
      }),
    );
    if (definition.action === "build") task.group = vscode.TaskGroup.Build;
    return task;
  }
}
