type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ConsoleLogger {
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  child(bindings: Record<string, unknown>): ConsoleLogger;
}

type LogMethod = (objOrMessage?: unknown, message?: string) => void;

const LEVEL_TO_CONSOLE: Record<LogLevel, 'debug' | 'log' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'log',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

/**
 * Structured JSON logger with the method surface Fastify requires of a custom
 * logger. Workers Logs indexes the JSON fields. Only `err`, bindings, and the
 * fields a caller passes are written, so request headers never reach the log.
 */
export function createConsoleLogger(
  bindings: Record<string, unknown> = {},
  sink: Pick<Console, 'debug' | 'log' | 'warn' | 'error'> = console,
): ConsoleLogger {
  const write =
    (level: LogLevel): LogMethod =>
    (objOrMessage, message) => {
      const fields: Record<string, unknown> = { level, ...bindings };
      if (objOrMessage instanceof Error) {
        fields.err = serializeError(objOrMessage);
        if (message) fields.msg = message;
      } else if (objOrMessage && typeof objOrMessage === 'object') {
        for (const [key, value] of Object.entries(objOrMessage)) {
          fields[key] = value instanceof Error ? serializeError(value) : value;
        }
        if (message) fields.msg = message;
      } else if (objOrMessage !== undefined) {
        fields.msg = String(objOrMessage);
      }
      sink[LEVEL_TO_CONSOLE[level]](JSON.stringify(fields));
    };

  return {
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    fatal: write('fatal'),
    child: (childBindings) => createConsoleLogger({ ...bindings, ...childBindings }, sink),
  };
}

function serializeError(error: Error): { name: string; message: string; stack?: string } {
  return { name: error.name, message: error.message, stack: error.stack };
}
