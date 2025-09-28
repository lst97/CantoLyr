import { load } from "jsr:@std/dotenv";
import { resolve } from "jsr:@std/path";
import { PrismaClient } from "../prisma/generated/client.ts";
import { getLogger } from "jsr:@std/log";

const logger = getLogger();

async function run(cmd: string, args: string[]) {
  const process = new Deno.Command(cmd, {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await process.status;
  if (code !== 0) {
    throw new Error(`${cmd} exited with status ${code}`);
  }
}

async function main() {
  await load({ export: true });
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    logger.error("❌ DATABASE_URL is not set. Please export it before running.");
    Deno.exit(1);
  }

  const sqlPath = resolve("scripts/init-db.sql");
  try {
    const stat = await Deno.stat(sqlPath);
    if (!stat.isFile) {
      throw new Error("not a file");
    }
  } catch {
    logger.error(`❌ Cannot find ${sqlPath}`);
    Deno.exit(1);
  }

  logger.info("🧹 Dropping + initializing schema from SQL...");
  let appliedVia: "psql" | "prisma-push" = "psql";
  try {
    await run("psql", ["-v", "ON_ERROR_STOP=1", databaseUrl, "-f", sqlPath]);
  } catch (_error) {
    let psqlWorked = false;
    if (Deno.build.os === "darwin") {
      logger.warn("⚠️  psql not in PATH, trying to locate via 'brew --prefix libpq'...");
      try {
        const { code, stdout, stderr } = await new Deno.Command("brew", {
          args: ["--prefix", "libpq"],
        }).output();
        if (code === 0) {
          const prefix = new TextDecoder().decode(stdout).trim();
          const psqlPath = `${prefix}/bin/psql`;
          await run(psqlPath, ["-v", "ON_ERROR_STOP=1", databaseUrl, "-f", sqlPath]);
          psqlWorked = true;
          logger.info(`✅ Used ${psqlPath}`);
        } else {
          const message = new TextDecoder().decode(stderr);
          logger.warn(`   ↳ 'brew --prefix libpq' failed: ${message.trim()}`);
        }
      } catch (psqlError) {
        const message = psqlError instanceof Error ? psqlError.message : String(psqlError);
        logger.warn(`   ↳ psql command failed: ${message}`);
      }
    }

    if (!psqlWorked) {
      logger.warn("⚠️  psql not available. Falling back to Prisma db push.");
      appliedVia = "prisma-push";
      await run("deno", ["run", "-A", "npm:prisma@latest", "db", "push", "--force-reset"]);
    }
  }

  logger.info("🔎 Verifying schema objects exist...");
  const verifyClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await verifyClient.$connect();
  try {
    if (appliedVia === "prisma-push") {
      logger.info("✅ Schema verified (applied via Prisma db push).");
    } else {
      const result: Array<{ exists: boolean }> = await verifyClient.$queryRawUnsafe(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'entries') AS exists",
      );
      const ok = Array.isArray(result) && result[0] && result[0].exists === true;
      if (!ok) {
        logger.warn(
          "⚠️  entries table not found after psql import. Applying Prisma schema (db push)...",
        );
        await run("deno", ["run", "-A", "npm:prisma@latest", "db", "push"]);
      } else {
        logger.info("✅ Schema verified.");
      }
    }
  } finally {
    await verifyClient.$disconnect();
  }

  logger.info("🧩 Regenerating Prisma client...");
  await run("deno", ["run", "-A", "npm:prisma@latest", "generate"]);

  logger.info("✅ Database schema reset complete.");
}

if (import.meta.main) {
  main().catch((error) => {
    logger.error(error);
    Deno.exit(1);
  });
}
