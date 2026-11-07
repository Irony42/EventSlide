/** Every refusal this module makes on purpose, as one sentence an operator can act on. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}
