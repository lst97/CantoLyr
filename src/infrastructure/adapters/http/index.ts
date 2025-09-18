import type { Hono } from "hono/";
import type { Container } from "../../container/Container.ts";
import { registerSearchRoutes } from "./routes/searchRoutes.ts";
import { registerLyricRoutes } from "./routes/lyricRoutes.ts";

export function registerHttpRoutes(app: Hono, container: Container) {
  registerSearchRoutes(app, container);
  registerLyricRoutes(app, container);
}
