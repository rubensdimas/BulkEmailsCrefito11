const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const knexfilePath = path.join(appRoot, "dist", "config", "knexfile.js");

if (!fs.existsSync(knexfilePath)) {
  throw new Error(`Compiled Knex configuration not found: ${knexfilePath}`);
}

const config = require(knexfilePath).default;
const migrationsDirectory = config?.production?.migrations?.directory;

if (typeof migrationsDirectory !== "string" || !path.isAbsolute(migrationsDirectory)) {
  throw new Error("Production migrations directory must be an absolute path");
}

if (!fs.statSync(migrationsDirectory).isDirectory()) {
  throw new Error(`Compiled migrations directory not found: ${migrationsDirectory}`);
}

const migrationFiles = fs
  .readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".js"))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error(`No compiled migrations found in: ${migrationsDirectory}`);
}

for (const migrationFile of migrationFiles) {
  const migration = require(path.join(migrationsDirectory, migrationFile));
  if (typeof migration.up !== "function" || typeof migration.down !== "function") {
    throw new Error(`Invalid migration exports: ${migrationFile}`);
  }
}

console.log(`Verified ${migrationFiles.length} production migrations in ${migrationsDirectory}`);
