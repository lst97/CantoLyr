import { load } from "jsr:@std/dotenv";
import { resolve } from "jsr:@std/path";
import { PrismaClient } from "../prisma/generated/client.ts";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

async function run(cmd: string, args: string[]) {
	const p = new Deno.Command(cmd, {
		args,
		stdout: "inherit",
		stderr: "inherit",
	}).spawn();
	const { code } = await p.status;
	if (code !== 0) throw new Error(`${cmd} exited with status ${code}`);
}

async function main() {
	await load({ export: true });
	const databaseUrl = Deno.env.get("DATABASE_URL");
	if (!databaseUrl) {
		logger.error(
			"❌ DATABASE_URL is not set. Please export it before running."
		);
		Deno.exit(1);
	}

	const sqlPath = resolve("scripts/init-db.sql");
	try {
		const stat = await Deno.stat(sqlPath);
		if (!stat.isFile) throw new Error("not a file");
	} catch {
		logger.error(`❌ Cannot find ${sqlPath}`);
		Deno.exit(1);
	}

	logger.info("🧹 Dropping + initializing schema from SQL...");
	let appliedVia = "psql";
	try {
		await run("psql", ["-v", "ON_ERROR_STOP=1", databaseUrl, "-f", sqlPath]);
	} catch (_e) {
		let psqlWorked = false;
		if (Deno.build.os === "darwin") {
			logger.warn(
				"⚠️  psql not in PATH, trying to find via 'brew --prefix libpq'..."
			);
			try {
				const { code, stdout, stderr } = await new Deno.Command("brew", {
					args: ["--prefix", "libpq"],
				}).output();
				if (code === 0) {
					const prefix = new TextDecoder().decode(stdout).trim();
					const psqlPath = `${prefix}/bin/psql`;
					await run(psqlPath, [
						"-v",
						"ON_ERROR_STOP=1",
						databaseUrl,
						"-f",
						sqlPath,
					]);
					psqlWorked = true;
					logger.info(`✅ Used ${psqlPath}`);
				} else {
					const error = new TextDecoder().decode(stderr);
					logger.warn(`   ↳ 'brew --prefix libpq' failed: ${error.trim()}`);
				}
			} catch (psqlErr) {
				const msg =
					psqlErr instanceof Error ? psqlErr.message : String(psqlErr);
				logger.warn(`   ↳ psql command failed: ${msg}`);
			}
		}

		if (!psqlWorked) {
			logger.warn(
				"⚠️  psql not available. Falling back to Prisma raw execution..."
			);
			appliedVia = "prisma-raw";
			const prisma = new PrismaClient({
				datasources: { db: { url: databaseUrl } },
			});
			await prisma.$connect();
			try {
				const sql = await Deno.readTextFile(sqlPath);
				const statements = sql
					.split(/;\s*(?:\n|$)/)
					.map((s) => s.trim())
					.filter((s) => s.length > 0 && !s.startsWith("--"));
				for (const stmt of statements) {
					// Skip DB-level statements in fallback (often lack perms)
					if (/^(CREATE\s+DATABASE|GRANT\s+ALL\s+PRIVILEGES)/i.test(stmt)) {
						continue;
					}
					try {
						await prisma.$executeRawUnsafe(stmt);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						logger.warn(`   ↳ Skipped: ${msg}`);
					}
				}
			} finally {
				await prisma.$disconnect();
			}
		}
	}

	logger.info("🔎 Verifying schema objects exist...");
	const verifyClient = new PrismaClient({
		datasources: { db: { url: databaseUrl } },
	});
	await verifyClient.$connect();
	try {
		const res: Array<{ exists: boolean }> = await verifyClient.$queryRawUnsafe(
			"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'entries') AS exists"
		);
		const ok = Array.isArray(res) && res[0] && (res[0] as any).exists === true;
		if (!ok) {
			logger.warn(
				`⚠️  entries table not found after ${appliedVia}. Applying Prisma schema (db push)...`
			);
			await run("deno", ["run", "-A", "npm:prisma@latest", "db", "push"]);
		} else {
			logger.info("✅ Schema verified.");
		}
	} finally {
		await verifyClient.$disconnect();
	}

	logger.info("🧩 Regenerating Prisma client...");
	await run("deno", ["run", "-A", "npm:prisma@latest", "generate"]);

	logger.info("🌱 Normalizing and seeding database...");
	await run("deno", ["run", "-A", "scripts/normalize-seed-db.ts"]);

	logger.info("✅ Done. Database reset, normalized, and seeded.");
}

if (import.meta.main) {
	main().catch((e) => {
		logger.error(e);
		Deno.exit(1);
	});
}
