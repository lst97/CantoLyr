import { ConsoleHandler, getLogger, LogRecord, setup } from "jsr:@std/log";
import { type LevelName } from "jsr:@std/log/levels";
import { blue } from "jsr:@std/fmt/colors";

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LoggerConfig {
	level: LogLevel;
	json: boolean;
	console: boolean;
	fileEnabled: boolean;
	filePath: string;
	rotate: { maxSizeBytes: number; maxBackupCount: number };
}

export interface LoggerFields {
	[key: string]: unknown;
}

export class Logger {
	private readonly inner: ReturnType<typeof getLogger>;
	private readonly fields: LoggerFields;

	private constructor(
		inner: ReturnType<typeof getLogger>,
		fields: LoggerFields = {}
	) {
		this.inner = inner;
		this.fields = fields;
	}

	static async init(config: LoggerConfig) {
		const handlers: Record<string, ConsoleHandler> = {};
		const level = config.level as LevelName;

		if (config.console) {
			handlers.console = new ConsoleHandler(level, {
				formatter: (rec) => Logger.format(rec, config.json),
			});
		}

		await setup({
			handlers,
			loggers: {
				app: { level, handlers: Object.keys(handlers) },
				http: { level, handlers: Object.keys(handlers) },
				db: { level, handlers: Object.keys(handlers) },
			},
		});
	}

	static for(
		name: "app" | "http" | "db" | "vector" = "app",
		fields: LoggerFields = {}
	): Logger {
		return new Logger(getLogger(name), fields);
	}

	child(fields: LoggerFields): Logger {
		return new Logger(this.inner, { ...this.fields, ...fields });
	}

	debug(msg: string, extra: LoggerFields = {}) {
		this.write("DEBUG", msg, extra);
	}
	info(msg: string, extra: LoggerFields = {}) {
		this.write("INFO", msg, extra);
	}
	warning(msg: string, extra: LoggerFields = {}) {
		this.write("WARNING", msg, extra);
	}
	error(msg: string, extra: LoggerFields = {}) {
		this.write("ERROR", msg, extra);
	}
	critical(msg: string, extra: LoggerFields = {}) {
		this.write("CRITICAL", msg, extra);
	}

	private write(level: LogLevel, msg: string, extra: LoggerFields) {
		const fields = { ...this.fields, ...extra };
		switch (level) {
			case "DEBUG":
				this.inner.debug(msg, fields);
				break;
			case "INFO":
				this.inner.info(msg, fields);
				break;
			case "WARNING":
				this.inner.warn(msg, fields);
				break;
			case "ERROR":
				this.inner.error(msg, fields);
				break;
			case "CRITICAL":
				this.inner.critical(msg, fields);
				break;
		}
	}

	private static format(rec: LogRecord, json: boolean): string {
		if (json) {
			const mergedArgs = rec.args.reduce((acc, arg) => {
				if (arg && typeof arg === "object" && !Array.isArray(arg)) {
					return Object.assign({}, acc, arg as Record<string, unknown>);
				}
				return acc;
			}, {} as Record<string, unknown>);
			const payload: Record<string, unknown> = {
				ts: rec.datetime.toISOString(),
				level: rec.levelName,
				msg: rec.msg,
			};
			return JSON.stringify(
				Object.assign(payload, mergedArgs),
				Logger.safeReplacer
			);
		}
		const args = rec.args
			.map((arg) => JSON.stringify(arg, Logger.safeReplacer))
			.join(" ");
		return `${blue(rec.levelName)} ${rec.msg} ${args}`;
	}

	static safeReplacer(_k: string, v: unknown) {
		if (typeof v === "bigint") return v.toString();
		return v;
	}
}

export function createRequestId(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `${Date.now()}-${Math.random()}`;
	}
}
