import type { Context, Next } from "hono";
import { Logger, createRequestId } from "../../../logging/Logger.ts";
import { getConnInfo } from "hono/deno";

export function requestLogger() {
	const httpLogger = Logger.for("http");
	return async (c: Context, next: Next) => {
		const start = performance.now();
		const reqId = c.req.header("x-request-id") || createRequestId();
		c.header("x-request-id", reqId);

		// Store request id on context locals for downstream usage
		c.set("reqId", reqId);

		try {
			await next();
		} finally {
			const dur = Math.round(performance.now() - start);
			const ua = c.req.header("user-agent") || "";
			const ip =
				c.req.header("x-forwarded-for") ||
				getConnInfo(c).remote.address ||
				"";
			const log = httpLogger.child({ reqId });
			log.info("request", {
				method: c.req.method,
				path: c.req.path,
				status: c.res.status,
				duration_ms: dur,
				ua,
				ip,
			});
		}
	};
}
