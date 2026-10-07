function databaseName() {
  if (process.env.DB_NAME) return process.env.DB_NAME;
  if (process.env.DATABASE_URL) {
    return decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  }
  return "color_library_portal";
}

function connectionConfig(database = databaseName()) {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${encodeURIComponent(database)}`;
    return { connectionString: url.toString() };
  }

  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database,
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres"
  };
}

module.exports = { databaseName, connectionConfig };
