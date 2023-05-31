interface ILogger {
  debug(message: string): void
  info(message: string): void
  error(message: string, ex?: Error): void
}

type LogLevel = "DEBUG" | "INFO" | "ERROR"

class Logger implements ILogger {
  debug(message: string): void {
      console.debug(this.format("DEBUG", message))
  }
  info(message: string): void {
      console.info(this.format("INFO", message))
  }
  error(message: string, ex?: Error): void {
      console.error(this.format("ERROR", message))
      if (ex) {
          console.error(ex)
      }
  }

  private format(level: LogLevel, str: string): string {
      return `${new Date().toUTCString()} - ${level}: ${str}`
  }
}

export const log: ILogger = new Logger()
