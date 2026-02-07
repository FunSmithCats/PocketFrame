import { JobValidationError, type AutomationStartPayload } from './job';
import { runAutomationCommand } from './runner';

let initialized = false;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function bootstrapAutomation(): void {
  if (initialized) {
    return;
  }

  if (!window.electronAPI) {
    return;
  }

  initialized = true;

  window.electronAPI.onAutomationStart(async (payload: AutomationStartPayload) => {
    try {
      await runAutomationCommand(payload, (event) => {
        window.electronAPI?.emitAutomationEvent(event);
      });
      window.electronAPI?.notifyAutomationDone();
    } catch (error) {
      const code = error instanceof JobValidationError ? 2 : 3;
      window.electronAPI?.notifyAutomationFail({
        error: toErrorMessage(error),
        code,
      });
    }
  });
}
