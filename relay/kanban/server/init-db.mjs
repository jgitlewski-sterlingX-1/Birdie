import 'dotenv/config';
import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

// Core application schema. Each statement is standalone (CREATE TABLE IF NOT
// EXISTS) so the set is idempotent and can run on a pool without
// multipleStatements enabled. Order matters: tables with foreign keys come
// after the tables they reference (users first).
export const CORE_TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      google_sub VARCHAR(255) NOT NULL,
      email VARCHAR(320) NOT NULL,
      name VARCHAR(255) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_google_sub (google_sub),
      UNIQUE KEY uq_users_email (email),
      INDEX idx_users_domain (domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS user_settings (
      user_id CHAR(36) PRIMARY KEY,
      settings_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS salesforce_accounts (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      salesforce_user_id VARCHAR(255) NULL,
      username VARCHAR(320) NULL,
      org_id VARCHAR(255) NOT NULL,
      instance_url TEXT NULL,
      scopes_json TEXT NOT NULL,
      token_json LONGTEXT NULL,
      status ENUM('connected', 'disconnected', 'error') NOT NULL DEFAULT 'connected',
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_synced_at TIMESTAMP NULL,
      UNIQUE KEY uq_salesforce_user_org (user_id, org_id),
      INDEX idx_salesforce_user_status (user_id, status),
      INDEX idx_salesforce_default (user_id, is_default),
      CONSTRAINT fk_salesforce_accounts_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS login_attempts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(320) NULL,
      domain VARCHAR(255) NULL,
      event_type ENUM('login_success', 'login_denied', 'login_error') NOT NULL,
      details TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_login_created_at (created_at),
      INDEX idx_login_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      email VARCHAR(320) NOT NULL,
      name VARCHAR(255) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      tokens_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NULL,
      INDEX idx_sessions_email (email),
      INDEX idx_sessions_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS gmail_accounts (
      account_email VARCHAR(320) PRIMARY KEY,
      user_domain VARCHAR(255) NULL,
      scopes_json TEXT NOT NULL,
      token_json LONGTEXT NULL,
      source ENUM('auth-login', 'gmail-connect') NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      last_connected_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_gmail_default (is_default),
      INDEX idx_gmail_domain (user_domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS email_messages (
      message_id VARCHAR(255) PRIMARY KEY,
      account_email VARCHAR(320) NOT NULL,
      thread_id VARCHAR(255) NULL,
      subject TEXT NULL,
      sender TEXT NULL,
      snippet TEXT NULL,
      body LONGTEXT NULL,
      received_at DATETIME NULL,
      seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_email_account_seen (account_email, seen_at),
      INDEX idx_email_thread (thread_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Create all core tables on an existing connection/pool (already pointed at the
// target database). Idempotent. Used by the server on startup and by the CLI.
export async function ensureCoreSchema(conn) {
  for (const ddl of CORE_TABLE_DDL) {
    await conn.query(ddl);
  }
}

// CLI entry: creates the database if needed, then the core tables.
async function main() {
  const required = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const dbName = process.env.MYSQL_DATABASE || 'relay';
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await conn.query(`USE \`${dbName}\``);
  await ensureCoreSchema(conn);
  await conn.end();
  console.log(`Database initialized successfully. Database: ${dbName}`);
}

// Only run the CLI when executed directly (not when imported by the server).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Failed to initialize database:', error.message);
    process.exit(1);
  });
}
