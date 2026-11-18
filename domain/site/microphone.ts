// What a person reads when the microphone cannot be used for "Speak your answer" (journey/process/AnswerFromNotes.tsx),
// by the browser's own reason, in place of the browser's message. Typing always works.

export function microphoneProblem(errorName: string | undefined): string {
  switch (errorName) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The browser is not letting this page use the microphone. Allow it in the browser\'s settings for this site, or type the answer.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Connect one, or type the answer.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone could not be started; another program may be using it. Close it and try again, or type the answer.';
    default:
      return 'The microphone could not be used here. Type the answer instead.';
  }
}
